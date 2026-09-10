/**
 * The §3 order-cycle wire shape.
 *
 * Blackout's parser requires exactly `vendorId`, `cycleId` and `name`, and
 * treats everything else as optional. Three optional fields it accepts are
 * deliberately not sent, because inventing them would be worse than omitting
 * them:
 *
 * - `items` needs a product join. `order_cycle_product` carries `variant_id`,
 *   not the `{sku, title}` pairs the field means, and resolving them is a graph
 *   call per cycle inside a sweep that runs every five minutes.
 * - `listingDeepLink` would point at a page that does not exist — the
 *   storefront has no order-cycle route at all.
 * - `soldOutSku` belongs to `sold_out`, which FBM does not emit.
 *
 * `ordersPlaced` used to be in that list, for want of an order-to-cycle link.
 * The link exists now and carries rows: the storefront tags line items with
 * `order_cycle_id` (`lib/data/order-cycles.ts`), and the `order.placed`
 * subscriber creates a row in `order_order_ordercyclemodule_order_cycle` per
 * (order, cycle). `countCycleOrders` reads it. See that function for why the
 * count is omitted rather than reported as zero when the read fails.
 */

export type BlackoutCycleFields = {
  vendorId: string
  cycleId: string
  name: string
  closingAt?: string
  ordersPlaced?: number
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

/**
 * A minimal view of the graph query, so this file does not depend on the
 * container's types just to make one read.
 */
type GraphQuery = {
  graph: (args: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: Array<Record<string, unknown>> }>
}

/**
 * Count the orders linked to a cycle, for `cycle.close`'s `ordersPlaced`.
 *
 * Reads the order↔cycle link table, which the `order.placed` subscriber writes
 * one row into per (order, cycle). The link is the right source rather than
 * `order_cycle_sale`: a sale row only exists for variants registered in the
 * cycle, so an order carrying an unregistered variant would go uncounted,
 * while the link is created for every order tagged with the cycle.
 *
 * **Returns `undefined`, not `0`, when the read fails.** Blackout's renderer
 * distinguishes the two: `undefined` drops the clause, `0` renders "0 order(s)
 * placed" (`packages/api/src/services/fbmMatrixBridge/messageFormat.ts`). A
 * cycle whose count could not be read is not a cycle that sold nothing, and
 * announcing the second in a vendor's room would be a confident falsehood. A
 * genuine zero is still sent as zero — that one is true.
 */
export async function countCycleOrders(
  query: GraphQuery,
  cycleId: string
): Promise<number | undefined> {
  try {
    // Loaded lazily, and with `require` rather than `import()` because
    // `moduleResolution: node16` would demand a `.js` extension on a dynamic
    // import that nothing else in this codebase writes.
    //
    // Lazy at all because `defineLink` runs at module load and needs the
    // module registry: a static import here would blow up every unit test
    // that reaches this file, including the sweep's own spec, which goes
    // nowhere near the link. Inside the try, an environment that cannot build
    // the link degrades to "count unknown" — the honest answer there.
    const link = (require("../links/order-order-cycle") as {
      default: { entryPoint: string }
    }).default

    const { data } = await query.graph({
      entity: link.entryPoint,
      fields: ["order_id"],
      filters: { order_cycle_id: cycleId },
    })
    return Array.isArray(data) ? data.length : undefined
  } catch {
    // The link table is absent in minimal test environments, and a sweep that
    // runs every five minutes must not fail over an optional field.
    return undefined
  }
}
