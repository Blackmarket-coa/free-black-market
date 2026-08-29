import { model } from "@medusajs/framework/utils"

/**
 * Balance monitors — threshold alerts on ledger accounts.
 *
 * The PRE_LAUNCH_AUDIT's negative-amount-payout bug class is exactly what
 * these catch structurally: a monitor on the settlement account with
 * `balance < 0` (or `> ceiling`) turns a silent drain into a paged
 * incident within one evaluation cycle.
 *
 * Design notes (ported from the Blnk Finance reference with its known
 * gaps fixed — see docs/REPO_CONSOLIDATION_REVIEW.md §5):
 * - Thresholds are stored as **integer cents**, precomputed at
 *   definition time; evaluation never converts floats.
 * - Monitors are **edge-triggered**: `was_breached` persists the last
 *   evaluated state and an alert fires only on the false→true
 *   transition, not on every evaluation while the condition holds.
 *   (Blnk is level-triggered and re-alerts on every transaction.)
 * - A zero threshold is valid ("alert when the balance reaches 0").
 * - The alert payload includes the observed value and account — the
 *   receiver never has to re-fetch to know what tripped.
 * - Alerts go through the existing observability event pair
 *   (`observability.incident.triggered` / `observability.metric.recorded`),
 *   which no-ops when sinks are unconfigured — safe to wire
 *   unconditionally. Breach history persists here regardless.
 *
 * `field` names the account column monitored. `operator` is normalized
 * at write time ("=" becomes "=="), so a stored monitor always uses the
 * six canonical operators.
 */
export const BalanceMonitor = model.define("hawala_balance_monitor", {
  id: model.id().primaryKey(),

  account_id: model.text(),

  field: model
    .enum(["balance", "available_balance", "pending_balance"])
    .default("balance"),

  /** One of: ">", "<", ">=", "<=", "==", "!=" (normalized). */
  operator: model.text(),

  /** Threshold in integer cents. Zero is allowed. */
  threshold_cents: model.number(),

  severity: model
    .enum(["low", "medium", "high", "critical"])
    .default("high"),

  description: model.text().nullable(),

  is_active: model.boolean().default(true),

  /** Last evaluated condition state — the edge-trigger memory. */
  was_breached: model.boolean().default(false),

  last_evaluated_at: model.dateTime().nullable(),
  last_breached_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["account_id", "is_active"], name: "idx_hawala_balance_monitor_account" },
])

/**
 * One breach event: the false→true transition of a monitor's condition.
 * `incident_key` is the dedup key sent to the observability sink
 * (`hawala-monitor-<monitor_id>`), so external alerting can coalesce.
 */
export const MonitorBreach = model.define("hawala_monitor_breach", {
  id: model.id().primaryKey(),

  monitor_id: model.text(),
  account_id: model.text(),

  /** The account field value observed at breach time, in integer cents. */
  observed_cents: model.number(),
  threshold_cents: model.number(),
  operator: model.text(),
  field: model.text(),

  incident_key: model.text(),

  occurred_at: model.dateTime(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["monitor_id", "occurred_at"], name: "idx_hawala_monitor_breach_monitor" },
])
