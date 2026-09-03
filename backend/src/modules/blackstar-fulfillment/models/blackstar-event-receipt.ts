import { model } from "@medusajs/framework/utils"

/**
 * One inbound Blackstar event, recorded so a replay is a no-op.
 *
 * Closes open contract item §9.4 in
 * `docs/integrations/federated-logistics.md`. It became possible when §9.2
 * closed: Blackstar's outbound envelope now carries the outbound record's
 * uuid, stable across retries, so `event_id` finally identifies an event
 * rather than an attempt. This is the symmetric counterpart to Blackstar's
 * own `fbm_inbound_event_receipts`.
 *
 * Until now FBM relied on being "idempotent by construction" — applying the
 * same event twice rewrote the same state. That was true only while every
 * handler stayed a blind overwrite. It stops being true the moment handling
 * has any history-dependence, which the out-of-order guard in
 * `shipment-lifecycle.ts` now gives it: replaying a `delivered` after a
 * `disputed` has landed would be evaluated against a different current state
 * and reach a different answer. A receipt table is what keeps replay
 * genuinely free rather than accidentally free.
 *
 * `outcome` records what the event actually did, not merely that it arrived,
 * so an operator reconciling a confusing timeline can tell an event that was
 * applied from one deliberately skipped as out-of-order.
 */
const BlackstarEventReceipt = model
  .define("blackstar_event_receipt", {
    id: model.id().primaryKey(),

    /** Blackstar's outbound event id. Unique — this is the dedupe key. */
    event_id: model.text(),

    event_type: model.text(),
    /** FBM's order id, carried as `payload.source_order_ref`. */
    source_order_ref: model.text().nullable(),
    correlation_id: model.text().nullable(),

    /** applied | same_status | out_of_order | terminal | unknown_status | ignored */
    outcome: model.text(),
    /** The status this event asked for, whether or not it was written. */
    requested_status: model.text().nullable(),
    /** The shipment's status after handling. */
    resulting_status: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["event_id"],
      name: "UQ_blackstar_event_receipt_event",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["source_order_ref"],
      name: "IDX_blackstar_event_receipt_order",
      where: "deleted_at IS NULL",
    },
  ])

export default BlackstarEventReceipt
