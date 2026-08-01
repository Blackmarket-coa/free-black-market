import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  QueryContext,
  defaultCurrencies,
} from "@medusajs/framework/utils"
import {
  BASE_UNIT_PRICE_METADATA_KEY,
  BASE_CURRENCY_METADATA_KEY,
  computeTierUnitPriceMinor,
  isSlidingScaleTier,
  SLIDING_SCALE_TIERS,
  SlidingScaleTier,
} from "../../../../../lib/sliding-scale"
import {
  PLAYBOOK_MODULE,
  PLAYBOOK_RECIPES,
  type PlaybookId,
} from "../../../../../modules/playbook"

type Body = { tier?: unknown }

/**
 * Apply the buyer's sliding-scale tier to the cart.
 *
 * 1. Validates the tier ∈ {supporter, standard, solidarity}.
 * 2. Loads every line item with its product metadata, finds the seller
 *    each product belongs to, and looks up the seller's playbook
 *    assignment.
 * 3. For each item whose seller's playbook has `allow_sliding_scale:
 *    true`, computes the tier-adjusted unit_price via
 *    `lib/sliding-scale.ts` and overrides the line item (setting
 *    is_custom_price so Medusa's pricing flow respects the override).
 * 4. The pricing base is the variant's authoritative calculated price,
 *    batch-fetched in the cart's currency (and region, when set). Line-item
 *    metadata is buyer-writable, so the stash under
 *    BASE_UNIT_PRICE_METADATA_KEY is still WRITTEN (for downstream
 *    patronage accounting and interop with the wholesale route) but is
 *    never READ as a pricing input — a hostile client could otherwise
 *    poison the base and have the reprice write an arbitrary unit_price.
 *    Items whose variant has no calculated price fall back to deriving
 *    the base from their current unit_price.
 * 5. Writes `cart.metadata.tier` and returns the cart.
 *
 * Line items from products on a Stall-playbook seller (or any seller
 * without a playbook assignment yet) are left untouched.
 *
 * Idempotency: calling with the currently-applied tier is a no-op for
 * line items whose recorded base, currency, tier, and price already match.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const body = (req.validatedBody || req.body || {}) as Body
  const tier = body.tier
  if (!isSlidingScaleTier(tier)) {
    return res.status(400).json({
      message: `tier must be one of: ${SLIDING_SCALE_TIERS.join(", ")}`,
    })
  }

  const cartModule: any = req.scope.resolve(Modules.CART)
  const playbookService: any = req.scope.resolve(PLAYBOOK_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "metadata",
      "currency_code",
      "region_id",
      "items.id",
      "items.product_id",
      "items.variant_id",
      "items.unit_price",
      "items.is_custom_price",
      "items.metadata",
    ],
    filters: { id },
  })
  const cart = carts?.[0]
  if (!cart) return res.status(404).json({ message: "Cart not found" })

  // Medusa line-item `unit_price` is a MAJOR-unit decimal (e.g. 19.99), but the
  // sliding-scale helper works in MINOR units (integer cents). Convert with the
  // currency's decimal_digits so the tier math keeps sub-unit precision instead
  // of rounding to whole currency units (a $19.99 solidarity item was becoming
  // $13 instead of $12.99), and so an absolute `sliding_scale_prices_minor`
  // value is not written 100× too large.
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
    variant_id: string | null
    unit_price: number | string
    is_custom_price?: boolean
    metadata: Record<string, unknown> | null
  }>

  const productIds = Array.from(
    new Set(items.map((i) => i.product_id).filter((p): p is string => !!p))
  )

  // SECURITY (audit: repricing base poisoning): line-item metadata is
  // buyer-writable, so it must never be trusted as the pricing base. Fetch the
  // authoritative per-variant price in the cart's currency/region instead; the
  // metadata stash is still written below for downstream accounting, but the
  // read path is gone.
  const variantIds = Array.from(
    new Set(items.map((i) => i.variant_id).filter((v): v is string => !!v))
  )
  const regionId = (cart as { region_id?: string | null }).region_id || null

  // variantId -> authoritative unit price in MINOR units
  const variantPriceMinor = new Map<string, number>()
  if (variantIds.length > 0) {
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "calculated_price.*"],
      filters: { id: variantIds },
      context: {
        calculated_price: QueryContext({
          currency_code: currencyCode,
          ...(regionId ? { region_id: regionId } : {}),
        }),
      },
    })
    for (const variant of (variants ?? []) as Array<{
      id: string
      calculated_price?: {
        calculated_amount?: number | string | null
      } | null
    }>) {
      const rawAmount = variant?.calculated_price?.calculated_amount
      const amount = typeof rawAmount === "string" ? Number(rawAmount) : rawAmount
      if (
        variant?.id &&
        typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount >= 0
      ) {
        variantPriceMinor.set(variant.id, toMinor(amount))
      }
    }
  }

  // productId -> { seller_id, metadata }
  const productInfo = new Map<
    string,
    { sellerId: string | null; metadata: Record<string, unknown> }
  >()

  if (productIds.length > 0) {
    // Query products by id and follow the seller link inward.
    // (The inverse — `entity: "seller", filters: { "products.id": ... }` —
    // works at runtime but isn't accepted by the RemoteQueryFilters<"seller">
    // type, which only allows direct seller fields as filter keys.)
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "metadata", "seller.id"],
      filters: { id: productIds },
    })
    for (const product of (products ?? []) as Array<{
      id: string
      metadata?: Record<string, unknown> | null
      seller?: { id: string } | null
    }>) {
      if (!product?.id) continue
      productInfo.set(product.id, {
        sellerId: product.seller?.id ?? null,
        metadata: (product.metadata ?? {}) as Record<string, unknown>,
      })
    }
  }

  // Batch the playbook lookup per unique seller.
  const sellerIds = Array.from(
    new Set(
      Array.from(productInfo.values())
        .map((v) => v.sellerId)
        .filter((s): s is string => !!s)
    )
  )

  const sellerAllowsSliding = new Map<string, boolean>()
  if (sellerIds.length > 0) {
    const assignments = (await playbookService.listPlaybookAssignments({
      seller_id: sellerIds,
    })) as Array<{ seller_id: string; recipe_id: string | null }>
    for (const a of assignments ?? []) {
      const recipe = a.recipe_id
        ? PLAYBOOK_RECIPES[a.recipe_id as PlaybookId]
        : null
      sellerAllowsSliding.set(a.seller_id, recipe?.allow_sliding_scale === true)
    }
  }

  const updates: Array<{
    id: string
    unit_price: number
    is_custom_price: boolean
    metadata: Record<string, unknown>
  }> = []

  for (const item of items) {
    if (!item.product_id) continue
    const info = productInfo.get(item.product_id)
    if (!info?.sellerId) continue
    if (!sellerAllowsSliding.get(info.sellerId)) continue

    const itemMeta = (item.metadata ?? {}) as Record<string, unknown>
    const currentUnitPrice =
      typeof item.unit_price === "string"
        ? Number(item.unit_price)
        : item.unit_price

    // Trusted base: the variant's calculated price (already fetched in the
    // cart's currency/region and converted to minor units). The metadata stash
    // is buyer-writable and is deliberately NEVER read here. When the variant
    // has no calculated price (or the item has no variant), fall back to
    // deriving the base from the current line price, as a first apply always
    // did.
    const authoritativeBaseMinor =
      item.variant_id != null
        ? variantPriceMinor.get(item.variant_id)
        : undefined
    const basePriceMinor =
      authoritativeBaseMinor !== undefined
        ? authoritativeBaseMinor
        : Number.isFinite(currentUnitPrice)
          ? toMinor(currentUnitPrice)
          : NaN

    if (!Number.isFinite(basePriceMinor) || basePriceMinor < 0) continue

    const nextUnitPrice = toMajor(
      computeTierUnitPriceMinor(
        tier as SlidingScaleTier,
        basePriceMinor,
        info.metadata
      )
    )

    const nextMetadata: Record<string, unknown> = {
      ...itemMeta,
      [BASE_UNIT_PRICE_METADATA_KEY]: basePriceMinor,
      [BASE_CURRENCY_METADATA_KEY]: currencyCode,
      sliding_scale_tier: tier,
    }

    // True idempotency: re-saving the same tier on an already-priced
    // line item (in the same currency) is a no-op.
    if (
      nextUnitPrice === currentUnitPrice &&
      item.is_custom_price === true &&
      itemMeta[BASE_UNIT_PRICE_METADATA_KEY] === basePriceMinor &&
      itemMeta[BASE_CURRENCY_METADATA_KEY] === currencyCode &&
      itemMeta.sliding_scale_tier === tier
    ) {
      continue
    }

    updates.push({
      id: item.id,
      unit_price: nextUnitPrice,
      is_custom_price: true,
      metadata: nextMetadata,
    })
  }

  if (updates.length > 0) {
    await cartModule.updateLineItems(updates)
  }

  const existingMd = (cart.metadata || {}) as Record<string, unknown>
  if (existingMd.tier !== tier) {
    await cartModule.updateCarts(id, {
      metadata: { ...existingMd, tier },
    })
  }

  return res.json({
    cart_id: id,
    tier,
    line_items_repriced: updates.length,
  })
}
