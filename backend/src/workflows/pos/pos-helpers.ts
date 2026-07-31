/**
 * Pure input-shaping for the POS order flow (roadmap Phase 3A / §1.7). Kept
 * free of any container / DB access so it is unit-testable; the workflow
 * performs the I/O (region default, variant enrichment, order creation).
 */

export type PosOrderItemInput = {
  variant_id?: string | null
  product_id?: string | null
  title?: string | null
  quantity?: number | null
  /** Integer minor units; POS operators may override catalog price in person. */
  unit_price: number
}

export type PosOrderInput = {
  seller_id: string
  items: PosOrderItemInput[]
  currency_code?: string | null
  region_id?: string | null
  sales_channel_id?: string | null
  customer_id?: string | null
  email?: string | null
  payment_method?: string | null
  note?: string | null
}

export type ShapedPosItem = {
  variant_id?: string
  product_id?: string
  title: string
  quantity: number
  unit_price: number
  metadata: { pos_sale: true }
}

export type PosValidationResult =
  | { ok: true; items: ShapedPosItem[] }
  | { ok: false; message: string }

/**
 * Validate + normalize POS line items: every item needs a positive finite
 * unit_price and either a variant_id (title resolved later from the catalog)
 * or an explicit title (ad-hoc / open-ring sale). Quantity defaults to 1.
 */
export function shapePosItems(items: PosOrderItemInput[]): PosValidationResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: "At least one line item is required" }
  }

  const shaped: ShapedPosItem[] = []
  for (const [index, item] of items.entries()) {
    const unitPrice = Number(item.unit_price)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return {
        ok: false,
        message: `items[${index}].unit_price must be a non-negative number (minor units)`,
      }
    }
    const quantity = Math.trunc(Number(item.quantity ?? 1))
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, message: `items[${index}].quantity must be a positive integer` }
    }
    if (!item.variant_id && !(item.title && item.title.trim())) {
      return {
        ok: false,
        message: `items[${index}] needs a variant_id or a title (ad-hoc sale)`,
      }
    }
    shaped.push({
      variant_id: item.variant_id ?? undefined,
      product_id: item.product_id ?? undefined,
      title: item.title?.trim() || "POS item",
      quantity,
      unit_price: Math.round(unitPrice),
      metadata: { pos_sale: true },
    })
  }
  return { ok: true, items: shaped }
}

/**
 * Per-variant inventory context resolved by the workflow (I/O side) and fed to
 * the pure adjustment planner below.
 */
export type PosVariantInventoryContext = {
  variant_id: string
  manage_inventory: boolean
  inventory_item_id?: string | null
  location_id?: string | null
}

export type PosInventoryAdjustment = {
  variant_id: string
  inventory_item_id: string
  location_id: string
  /** Units sold (positive); the step applies this as a negative delta. */
  quantity: number
}

export type PosInventorySkip = {
  variant_id: string
  reason:
    | "unknown_variant"
    | "not_managed"
    | "no_inventory_item"
    | "no_location_level"
}

export type PosInventoryPlan = {
  adjustments: PosInventoryAdjustment[]
  skipped: PosInventorySkip[]
}

/**
 * Map shaped POS line items to the inventory decrements they imply. Pure —
 * the workflow resolves each variant's inventory context (manage_inventory,
 * linked inventory item, stock location) and this decides what to adjust.
 *
 * Ad-hoc items (no variant_id) never touch inventory. A variant rung up on
 * multiple lines is aggregated into one adjustment. Variants that are
 * unmanaged or missing an inventory item / location are reported as skips so
 * the step can log them without failing the sale.
 */
export function planPosInventoryAdjustments(
  items: Array<Pick<ShapedPosItem, "variant_id" | "quantity">>,
  variants: PosVariantInventoryContext[]
): PosInventoryPlan {
  const contextByVariant = new Map(variants.map((v) => [v.variant_id, v]))

  const quantityByVariant = new Map<string, number>()
  for (const item of items) {
    if (!item.variant_id) continue
    quantityByVariant.set(
      item.variant_id,
      (quantityByVariant.get(item.variant_id) ?? 0) + item.quantity
    )
  }

  const adjustments: PosInventoryAdjustment[] = []
  const skipped: PosInventorySkip[] = []
  for (const [variantId, quantity] of quantityByVariant) {
    const context = contextByVariant.get(variantId)
    if (!context) {
      skipped.push({ variant_id: variantId, reason: "unknown_variant" })
      continue
    }
    if (!context.manage_inventory) {
      skipped.push({ variant_id: variantId, reason: "not_managed" })
      continue
    }
    if (!context.inventory_item_id) {
      skipped.push({ variant_id: variantId, reason: "no_inventory_item" })
      continue
    }
    if (!context.location_id) {
      skipped.push({ variant_id: variantId, reason: "no_location_level" })
      continue
    }
    adjustments.push({
      variant_id: variantId,
      inventory_item_id: context.inventory_item_id,
      location_id: context.location_id,
      quantity,
    })
  }
  return { adjustments, skipped }
}

/**
 * Order-level metadata for a POS sale. The `order_channel: "pos"` stamp is
 * what the `attribute-channel-on-placed` subscriber picks up; the pos_*
 * fields keep operator context for receipts / audits.
 */
export function buildPosOrderMetadata(args: {
  seller_id: string
  payment_method?: string | null
  note?: string | null
}): Record<string, unknown> {
  return {
    order_channel: "pos",
    pos_seller_id: args.seller_id,
    pos_payment_method: args.payment_method || "cash",
    ...(args.note ? { pos_note: args.note } : {}),
  }
}
