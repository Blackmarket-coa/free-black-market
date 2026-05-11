import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  BASE_UNIT_PRICE_METADATA_KEY,
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
 * 4. Stashes the base (standard-tier, i.e. listed) unit price on line
 *    item metadata under BASE_UNIT_PRICE_METADATA_KEY on first apply,
 *    so subsequent re-applies (buyer toggles between tiers) always
 *    derive from the original listed price rather than compounding.
 * 5. Writes `cart.metadata.tier` and returns the cart.
 *
 * Line items from products on a Stall-playbook seller (or any seller
 * without a playbook assignment yet) are left untouched.
 *
 * Idempotency: calling with the currently-applied tier is a no-op for
 * line items whose stashed base equals their current unit_price.
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
      "items.id",
      "items.product_id",
      "items.unit_price",
      "items.is_custom_price",
      "items.metadata",
    ],
    filters: { id },
  })
  const cart = carts?.[0]
  if (!cart) return res.status(404).json({ message: "Cart not found" })

  const items = (cart.items ?? []) as Array<{
    id: string
    product_id: string | null
    unit_price: number | string
    is_custom_price?: boolean
    metadata: Record<string, unknown> | null
  }>

  const productIds = Array.from(
    new Set(items.map((i) => i.product_id).filter((p): p is string => !!p))
  )

  // productId -> { seller_id, metadata }
  const productInfo = new Map<
    string,
    { sellerId: string | null; metadata: Record<string, unknown> }
  >()

  if (productIds.length > 0) {
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "products.id", "products.metadata"],
      filters: { "products.id": productIds },
    })
    for (const seller of (sellers ?? []) as Array<{
      id: string
      products?: Array<{ id: string; metadata?: Record<string, unknown> | null }>
    }>) {
      for (const product of seller.products ?? []) {
        if (!product?.id) continue
        productInfo.set(product.id, {
          sellerId: seller.id,
          metadata: (product.metadata ?? {}) as Record<string, unknown>,
        })
      }
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
    const stashed = itemMeta[BASE_UNIT_PRICE_METADATA_KEY]
    const currentUnitPrice =
      typeof item.unit_price === "string"
        ? Number(item.unit_price)
        : item.unit_price

    // On first apply, stash the current unit_price as the base. On
    // subsequent applies, always derive from the stash so toggling
    // between tiers stays referenced to the original listed price.
    const basePriceMinor =
      typeof stashed === "number" && Number.isFinite(stashed) && stashed >= 0
        ? stashed
        : currentUnitPrice

    if (!Number.isFinite(basePriceMinor) || basePriceMinor < 0) continue

    const nextUnitPrice = computeTierUnitPriceMinor(
      tier as SlidingScaleTier,
      basePriceMinor,
      info.metadata
    )

    const nextMetadata: Record<string, unknown> = {
      ...itemMeta,
      [BASE_UNIT_PRICE_METADATA_KEY]: basePriceMinor,
      sliding_scale_tier: tier,
    }

    // True idempotency: re-saving the same tier on an already-priced
    // line item is a no-op.
    if (
      nextUnitPrice === currentUnitPrice &&
      item.is_custom_price === true &&
      itemMeta[BASE_UNIT_PRICE_METADATA_KEY] === basePriceMinor &&
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
