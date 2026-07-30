import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  defaultCurrencies,
} from "@medusajs/framework/utils"
import {
  BASE_UNIT_PRICE_METADATA_KEY,
  BASE_CURRENCY_METADATA_KEY,
} from "../../../../../lib/sliding-scale"
import {
  WHOLESALE_DISCOUNT_METADATA_KEY,
  checkWholesaleMinimums,
  computeWholesaleUnitPriceMinor,
  type WholesaleMinimumShortfall,
} from "../../../../../lib/wholesale-pricing"
import { VENDOR_RULES_MODULE } from "../../../../../modules/vendor-rules"
import type VendorRulesService from "../../../../../modules/vendor-rules/service"
import { CustomerTierType } from "../../../../../modules/vendor-rules/models/vendor-customer-tier"

/**
 * Apply the buyer's wholesale tier pricing to the cart (MOQ + tier discount).
 *
 * Mechanics clone `../tier/route.ts` (same auth posture: no middleware, the
 * cart id is the capability):
 *
 * 1. Loads every line item, resolves the seller each product belongs to,
 *    and looks up the customer's VendorCustomerTier per seller
 *    (vendor-rules module). The customer comes from the cart itself
 *    (`cart.customer_id`), falling back to the session's customer actor
 *    for carts not yet claimed.
 * 2. A seller's items participate when the customer's tier is WHOLESALE or
 *    carries a `discount_percent > 0` (e.g. PREFERRED/RESTAURANT programs).
 * 3. MOQ gate: before touching any price, the seller's order minimums
 *    (vendor_rules.min_order_value / min_order_items) are checked against
 *    the prospective (discounted) per-seller subtotal — mirroring
 *    validateOrder, which compares post-discount totals. A tier with
 *    `waive_order_minimum` skips the gate. Any shortfall => 400
 *    `{code: "moq_unmet", unmet: [...]}` and NO price changes.
 * 4. Otherwise each participating item's unit_price is overridden to the
 *    discounted price via `lib/wholesale-pricing.ts` (is_custom_price so
 *    Medusa's pricing flow respects the override).
 * 5. The original listed unit price is stashed on line-item metadata under
 *    the shared sliding-scale BASE_UNIT_PRICE_METADATA_KEY (tagged with its
 *    currency) on first apply, so re-applies — and interleaved sliding-scale
 *    applies — always derive from the original listed price rather than
 *    compounding.
 *
 * No tier / no discount => 200 no-op with `{applied: false}`.
 *
 * Idempotency: re-POSTing with an unchanged tier is a no-op for line items
 * whose stash, discount, and price already match.
 *
 * v1 = percentage tier discount + MOQ gate. Per-product quantity brackets
 * (docs/LISTING_TYPES.md `tier_pricing: [{min_qty, price_per_unit}]`) can
 * layer on top later — see lib/wholesale-pricing.ts.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const cartModule: any = req.scope.resolve(Modules.CART)
  const vendorRules = req.scope.resolve(
    VENDOR_RULES_MODULE
  ) as unknown as VendorRulesService
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "metadata",
      "currency_code",
      "customer_id",
      "items.id",
      "items.product_id",
      "items.quantity",
      "items.unit_price",
      "items.is_custom_price",
      "items.metadata",
    ],
    filters: { id },
  })
  const cart = carts?.[0]
  if (!cart) return res.status(404).json({ message: "Cart not found" })

  // Wholesale tiers are keyed by customer id, so an anonymous cart can never
  // qualify: without a customer this is a 200 no-op, not an auth error.
  const authContext = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  const customerId =
    (cart as { customer_id?: string | null }).customer_id ||
    (authContext?.actor_type === "customer" ? authContext.actor_id : null) ||
    null
  if (!customerId) {
    return res.json({ cart_id: id, applied: false, reason: "no_customer" })
  }

  // Medusa line-item `unit_price` is a MAJOR-unit decimal; the wholesale
  // helper works in MINOR units (integer cents). Same conversion as the tier
  // route so sub-unit precision survives the round-trip.
  const currencyCode = String(
    (cart as { currency_code?: string }).currency_code || "usd"
  ).toLowerCase()
  const decimalDigits =
    (defaultCurrencies as Record<string, { decimal_digits?: number }>)[
      currencyCode
    ]?.decimal_digits ?? 2
  const minorFactor = 10 ** decimalDigits
  const toMinor = (major: number) => Math.round(major * minorFactor)
  const toMajor = (minor: number) => minor / minorFactor

  const items = (cart.items ?? []) as Array<{
    id: string
    product_id: string | null
    quantity: number | string
    unit_price: number | string
    is_custom_price?: boolean
    metadata: Record<string, unknown> | null
  }>

  const productIds = Array.from(
    new Set(items.map((i) => i.product_id).filter((p): p is string => !!p))
  )

  // productId -> sellerId (brackets v2 would also need product metadata here)
  const productSeller = new Map<string, string>()
  if (productIds.length > 0) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "seller.id"],
      filters: { id: productIds },
    })
    for (const product of (products ?? []) as Array<{
      id: string
      seller?: { id: string } | null
    }>) {
      if (product?.id && product.seller?.id) {
        productSeller.set(product.id, product.seller.id)
      }
    }
  }

  const sellerIds = Array.from(new Set(productSeller.values()))
  const tiersBySeller = await vendorRules.getCustomerTiersForSellers(
    sellerIds,
    customerId
  )

  const isWholesaleApplicable = (
    tier:
      | { tier_type?: string; discount_percent?: number }
      | null
      | undefined
  ) =>
    !!tier &&
    (tier.tier_type === CustomerTierType.WHOLESALE ||
      Number(tier.discount_percent) > 0)

  type Candidate = {
    itemId: string
    sellerId: string
    quantity: number
    basePriceMinor: number
    nextUnitPriceMinor: number
    nextUnitPrice: number
    currentUnitPrice: number
    isCustomPrice: boolean
    itemMeta: Record<string, unknown>
    discountPercent: number
  }
  const candidates: Candidate[] = []

  for (const item of items) {
    if (!item.product_id) continue
    const sellerId = productSeller.get(item.product_id)
    if (!sellerId) continue
    const tier = tiersBySeller.get(sellerId)
    if (!isWholesaleApplicable(tier)) continue

    const discountPercent = Math.max(0, Number(tier!.discount_percent) || 0)

    const itemMeta = (item.metadata ?? {}) as Record<string, unknown>
    const stashed = itemMeta[BASE_UNIT_PRICE_METADATA_KEY]
    const stashedCurrency = itemMeta[BASE_CURRENCY_METADATA_KEY]
    const currentUnitPrice =
      typeof item.unit_price === "string"
        ? Number(item.unit_price)
        : item.unit_price

    // Same stash-validity rules as the tier route: a base captured in another
    // currency must not be reused; legacy stashes with no currency tag are
    // treated as current-currency for back-compat.
    const stashCurrencyMatches =
      typeof stashedCurrency !== "string" || stashedCurrency === currencyCode
    const stashUsable =
      typeof stashed === "number" &&
      Number.isFinite(stashed) &&
      stashed >= 0 &&
      stashCurrencyMatches

    const basePriceMinor = stashUsable
      ? (stashed as number)
      : Number.isFinite(currentUnitPrice)
        ? toMinor(currentUnitPrice)
        : NaN

    if (!Number.isFinite(basePriceMinor) || basePriceMinor < 0) continue

    const nextUnitPriceMinor = computeWholesaleUnitPriceMinor(
      basePriceMinor,
      discountPercent
    )

    const rawQuantity =
      typeof item.quantity === "string"
        ? Number(item.quantity)
        : item.quantity
    const quantity =
      Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 0

    candidates.push({
      itemId: item.id,
      sellerId,
      quantity,
      basePriceMinor,
      nextUnitPriceMinor,
      nextUnitPrice: toMajor(nextUnitPriceMinor),
      currentUnitPrice,
      isCustomPrice: item.is_custom_price === true,
      itemMeta,
      discountPercent,
    })
  }

  if (candidates.length === 0) {
    return res.json({ cart_id: id, applied: false })
  }

  // MOQ gate — checked against the prospective (discounted) per-seller
  // subtotal BEFORE any price is written; any shortfall aborts the apply.
  const applicableSellerIds = Array.from(
    new Set(candidates.map((c) => c.sellerId))
  )
  const minimums = await vendorRules.getOrderMinimumsForSellers(
    applicableSellerIds
  )
  const unmetBySeller: Array<{
    seller_id: string
    unmet: WholesaleMinimumShortfall[]
  }> = []
  for (const sellerId of applicableSellerIds) {
    const tier = tiersBySeller.get(sellerId)
    const mins = minimums.get(sellerId) ?? {
      min_order_value: 0,
      min_order_items: 1,
    }
    const check = checkWholesaleMinimums({
      items: candidates
        .filter((c) => c.sellerId === sellerId)
        .map((c) => ({
          quantity: c.quantity,
          unitPriceMinor: c.nextUnitPriceMinor,
        })),
      minOrderItems: mins.min_order_items,
      minOrderValueMinor: mins.min_order_value,
      waive: tier?.waive_order_minimum === true,
    })
    if (!check.ok) {
      unmetBySeller.push({ seller_id: sellerId, unmet: check.unmet })
    }
  }

  if (unmetBySeller.length > 0) {
    return res.status(400).json({ code: "moq_unmet", unmet: unmetBySeller })
  }

  const updates: Array<{
    id: string
    unit_price: number
    is_custom_price: boolean
    metadata: Record<string, unknown>
  }> = []

  for (const c of candidates) {
    const nextMetadata: Record<string, unknown> = {
      ...c.itemMeta,
      [BASE_UNIT_PRICE_METADATA_KEY]: c.basePriceMinor,
      [BASE_CURRENCY_METADATA_KEY]: currencyCode,
      [WHOLESALE_DISCOUNT_METADATA_KEY]: c.discountPercent,
    }

    // True idempotency: re-applying the same discount to an already-priced
    // line item (in the same currency) is a no-op.
    if (
      c.nextUnitPrice === c.currentUnitPrice &&
      c.isCustomPrice &&
      c.itemMeta[BASE_UNIT_PRICE_METADATA_KEY] === c.basePriceMinor &&
      c.itemMeta[BASE_CURRENCY_METADATA_KEY] === currencyCode &&
      c.itemMeta[WHOLESALE_DISCOUNT_METADATA_KEY] === c.discountPercent
    ) {
      continue
    }

    updates.push({
      id: c.itemId,
      unit_price: c.nextUnitPrice,
      is_custom_price: true,
      metadata: nextMetadata,
    })
  }

  if (updates.length > 0) {
    await cartModule.updateLineItems(updates)
  }

  const existingMd = (cart.metadata || {}) as Record<string, unknown>
  if (existingMd.wholesale_applied !== true) {
    await cartModule.updateCarts(id, {
      metadata: { ...existingMd, wholesale_applied: true },
    })
  }

  return res.json({
    cart_id: id,
    applied: true,
    line_items_repriced: updates.length,
    sellers: applicableSellerIds,
  })
}
