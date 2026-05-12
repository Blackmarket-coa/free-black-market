import { model } from "@medusajs/framework/utils"

/**
 * SettlementRecord
 *
 * Project-scoped wrapper around a hawala-ledger entry. Lets the
 * asset-graph layer report flows of value by project without coupling
 * the ledger schema to asset-graph concepts.
 *
 * Each row points back to a `ledger_entry.id` for the canonical
 * accounting truth; this table adds the project context (manifest slug,
 * project instance) and an indexed view by rail.
 *
 * v0 defines the schema only; the executor that emits these rows lands
 * with the matching engine in v0.1.
 */
const SettlementRecord = model.define("settlement_record", {
  id: model.id().primaryKey(),

  /** Slug of the `project_manifest` the settlement is scoped to. */
  manifest_slug: model.text(),

  /** Optional FK to `project_instance.id` once instances exist. */
  project_instance_id: model.text().nullable(),

  /** FK to `hawala-ledger.ledger_entry.id` for the canonical entry. */
  ledger_entry_id: model.text().nullable(),

  /** ccr | usdc | usd | karma | hours | gift. */
  rail: model.text(),

  from_member_id: model.text(),
  to_member_id: model.text(),

  /**
   * Stored as integer minor units (cents for fiat, hundredths of an
   * hour for hours, raw count for gift). The rail tells the consumer
   * how to interpret. v0 keeps it simple; precision-typed amounts can
   * be introduced when the executor lands.
   */
  amount_minor: model.bigNumber(),

  /** Currency or unit identifier ("CCR", "USDC", "USD", "KARMA", "HRS", "GIFT"). */
  asset_code: model.text(),

  occurred_at: model.dateTime(),

  /**
   * Caller-supplied idempotency key. When set, the service's
   * emitSettlementRecord path checks for an existing record with the
   * same key and returns it instead of writing a duplicate. Callers
   * who can't synthesize a natural key (e.g. ad-hoc operator
   * actions) leave this null and accept that re-emitting is the
   * caller's responsibility.
   *
   * Convention for systematic emitters: `${manifest_slug}-${source_id}`
   * where source_id is the project instance event id (e.g. a loan
   * id, a repair completion id). This makes "two emits for the same
   * event" return the same SettlementRecord row.
   *
   * The DB-level uniqueness is enforced by a partial unique index
   * (only when the key is not null) created by the migration —
   * Medusa's model DSL doesn't expose `.unique()` on nullable columns,
   * so the index is the canonical guard.
   */
  idempotency_key: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["manifest_slug"], name: "IDX_settlement_record_manifest_slug" },
  {
    on: ["project_instance_id"],
    name: "IDX_settlement_record_project_instance_id",
  },
  { on: ["ledger_entry_id"], name: "IDX_settlement_record_ledger_entry_id" },
  { on: ["rail"], name: "IDX_settlement_record_rail" },
  { on: ["from_member_id"], name: "IDX_settlement_record_from_member_id" },
  { on: ["to_member_id"], name: "IDX_settlement_record_to_member_id" },
  {
    on: ["idempotency_key"],
    name: "IDX_settlement_record_idempotency_key",
  },
])

export default SettlementRecord
