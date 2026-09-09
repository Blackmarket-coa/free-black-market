/**
 * The §3 order-cycle wire shape.
 *
 * Blackout's parser requires exactly `vendorId`, `cycleId` and `name`, and
 * treats everything else as optional. Four optional fields it accepts are
 * deliberately not sent, because inventing them would be worse than omitting
 * them:
 *
 * - `items` needs a product join. `order_cycle_product` carries `variant_id`,
 *   not the `{sku, title}` pairs the field means, and resolving them is a graph
 *   call per cycle inside a sweep that runs every five minutes.
 * - `ordersPlaced` needs an order-to-cycle link that does not exist: the
 *   storefront does not write `order_cycle_id` into the cart yet, which is the
 *   other half of the roadmap's item 12. A count derived from anything else
 *   would be a number that looks authoritative and is not.
 * - `listingDeepLink` would point at a page that does not exist — the
 *   storefront has no order-cycle route at all.
 * - `soldOutSku` belongs to `sold_out`, which FBM does not emit.
 */

export type BlackoutCycleFields = {
  vendorId: string
  cycleId: string
  name: string
  closingAt?: string
}

type CycleRow = Record<string, unknown>

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

const iso = (v: unknown): string | undefined => {
  if (v instanceof Date) return v.toISOString()
  const s = str(v)
  return s ?? undefined
}

/**
 * Project a cycle onto the wire. Returns null when the row lacks any of the
 * three fields Blackout requires — an event it would reject is worth not
 * sending, and the caller logs the skip rather than enqueuing a delivery that
 * can only fail.
 */
export function toBlackoutCycleFields(row: CycleRow): BlackoutCycleFields | null {
  const vendorId = str(row.coordinator_seller_id)
  const cycleId = str(row.id)
  const name = str(row.name)

  if (!vendorId || !cycleId || !name) return null

  const closingAt = iso(row.closes_at)

  return {
    vendorId,
    cycleId,
    name,
    ...(closingAt ? { closingAt } : {}),
  }
}

/** The event type for a transition. `open` and `closed` are the only two. */
export function cycleEventTypeFor(status: string): string | null {
  if (status === "open") return "cycle.open"
  if (status === "closed") return "cycle.close"
  return null
}
