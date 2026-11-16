/**
 * A delivery's status history, as the column holds it and as it is read.
 *
 * `food_delivery.status_history` is a json column, and the service is its
 * writer of record: `createDeliveryForOrder` starts it and
 * `updateDeliveryStatus` appends to it, both as `{ entries: [...] }`. That
 * is the stored shape.
 *
 * `POST /vendor/deliveries/:id` used to keep its own copy of that append and
 * treated the column as a bare list (SD-119 (1)). On a delivery made by the
 * service it spread the object and answered 500 "existingHistory is not
 * iterable", which is every delivery `POST /store/food-deliveries` creates.
 * On a delivery with no history yet it wrote a bare list, and the service's
 * next update of that row then failed in turn: `list.entries` is
 * `Array.prototype.entries`, a function, so `existingHistory?.entries || []`
 * was not a list and `.push` threw.
 *
 * So a row may hold either shape, or nothing. Everything that reads the
 * column goes through `statusHistoryEntries`, which accepts all three, and
 * the service writes the entries back as `{ entries }`: a row left as a bare
 * list is put right by its next status change. To list such rows, and to
 * rewrite them without waiting for one (both run as written in
 * `integration-tests/http/store-food-network-owner-reads.spec.ts`; also in
 * `docs/AUDIT_DEBT.md`, SD-119):
 *
 *   SELECT id FROM food_delivery
 *    WHERE deleted_at IS NULL AND jsonb_typeof(status_history) = 'array';
 *
 *   UPDATE food_delivery
 *      SET status_history = jsonb_build_object('entries', status_history)
 *    WHERE deleted_at IS NULL AND jsonb_typeof(status_history) = 'array';
 */
export type DeliveryStatusEntry = {
  status: string
  timestamp: string
  location?: { latitude: number; longitude: number }
  note?: string
  /** Who made the change, when the caller said: "vendor", for one. */
  actor?: string
}

/** The entries of a status history, oldest first, whichever shape it has. */
export function statusHistoryEntries(history: unknown): DeliveryStatusEntry[] {
  if (Array.isArray(history)) {
    return [...(history as DeliveryStatusEntry[])]
  }
  const entries = (history as { entries?: unknown } | null | undefined)?.entries
  return Array.isArray(entries) ? [...(entries as DeliveryStatusEntry[])] : []
}

/**
 * A delivery row with `status_history` as the list of its entries.
 *
 * What `/vendor/deliveries` serves: the vendor panel types the field as a
 * list (`StatusHistoryEntry[] | null`) and renders it with `.length` and
 * `.map`, so the stored `{ entries }` object showed it no history at all.
 * A delivery with no history keeps its null.
 */
export function withStatusHistoryList<T extends Record<string, unknown>>(
  delivery: T
): T {
  if (delivery.status_history === null || delivery.status_history === undefined) {
    return delivery
  }
  return { ...delivery, status_history: statusHistoryEntries(delivery.status_history) }
}
