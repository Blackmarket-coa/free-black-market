import { model } from "@medusajs/framework/utils"

/**
 * KarmaEvent
 *
 * Karma is non-fungible: it does not move from one member to another.
 * It accrues from system events (a repair completed, a tool returned
 * intact, a community shift covered) and can be deducted by counter-
 * events (a bad-faith dispute, a no-show, a returned tool damaged).
 *
 * Because karma has no counterparty, double-entry ledger semantics
 * are wrong for it; this table stores the per-member event log
 * directly. A member's karma at time T is the signed sum of their
 * events up to T.
 *
 * `reason` is a short slug — e.g. `repair-completed`,
 * `tool-loan-returned`, `event-shift-covered`, `dispute-bad-faith`.
 * The reason vocabulary is owned by callers (each manifest can define
 * its own); the ledger treats them as opaque tags.
 *
 * `source_module` and `source_id` together point back to the artifact
 * that produced the event (e.g. an asset-graph
 * `SettlementRecord.id`, a Threshold loan completion, a repair-café
 * intake record). They're optional because karma can also be granted
 * by operator action without a source record.
 *
 * See `docs/COMPOSITION_LAYER.md` for the anti-hoarding role of
 * karma in the substrate, and `docs/POSTURE_A_COMPLIANCE.md` for why
 * karma is closed-loop (cannot be converted to cash and is not
 * transferable).
 */
const KarmaEvent = model.define("karma_event", {
  id: model.id().primaryKey(),

  /** BMC member identifier (FK kept loose; identity module unset in v0). */
  member_id: model.text(),

  /**
   * Signed integer delta. Positive = accrual, negative = deduction.
   * Karma units are dimensionless; magnitude semantics belong to the
   * issuing context.
   */
  delta: model.number(),

  /**
   * Short slug describing the event (e.g. `repair-completed`,
   * `tool-loan-returned`, `dispute-bad-faith`). Vocabulary is per-
   * manifest; the ledger treats them as opaque.
   */
  reason: model.text(),

  /**
   * Module that produced the event, when the karma comes from a
   * recorded artifact. Examples: `asset_graph`, `threshold`,
   * `vendor_verification`. Null for operator-granted karma.
   */
  source_module: model.text().nullable(),

  /**
   * Identifier within `source_module`. Together with `source_module`
   * this is the audit trail back to the originating record.
   */
  source_id: model.text().nullable(),

  /**
   * When the event occurred (separate from `created_at`, which is
   * the row write time). Lets the event log be backfilled
   * historically.
   */
  occurred_at: model.dateTime(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["member_id"], name: "IDX_karma_event_member_id" },
  { on: ["reason"], name: "IDX_karma_event_reason" },
  {
    on: ["source_module", "source_id"],
    name: "IDX_karma_event_source",
  },
])

export default KarmaEvent
