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
