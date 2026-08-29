/**
 * Balance-monitor evaluation — pure logic.
 *
 * Monitors are edge-triggered: an alert fires on the false→true
 * transition of the condition, and a "clear" transition is reported so
 * the monitor's stored state can reset. Evaluating a condition that
 * already breached last time produces no new alert (the Blnk reference
 * is level-triggered and re-alerts on every evaluation — the single
 * biggest quality-of-life gap this port fixes).
 *
 * All comparisons are integer cents. "=" is accepted as input and
 * normalized to "==" (the Blnk reference stored "=" but its comparator
 * only understood "==", so such monitors never fired).
 */

export const MONITOR_OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const
export type MonitorOperator = (typeof MONITOR_OPERATORS)[number]

export const MONITOR_FIELDS = ["balance", "available_balance", "pending_balance"] as const
export type MonitorField = (typeof MONITOR_FIELDS)[number]

/** Normalize and validate an operator; throws on anything unrecognized. */
export function normalizeOperator(op: string): MonitorOperator {
  const trimmed = op.trim()
  const normalized = trimmed === "=" ? "==" : trimmed
  if (!MONITOR_OPERATORS.includes(normalized as MonitorOperator)) {
    throw new Error(
      `Unknown monitor operator ${JSON.stringify(op)} (expected one of ${MONITOR_OPERATORS.join(", ")} — "=" is accepted and normalized to "==")`
    )
  }
  return normalized as MonitorOperator
}

export function isMonitorField(field: string): field is MonitorField {
  return MONITOR_FIELDS.includes(field as MonitorField)
}

/** Whether the monitored condition currently holds. Zero thresholds are valid. */
export function conditionMet(
  observedCents: number,
  operator: MonitorOperator,
  thresholdCents: number
): boolean {
  switch (operator) {
    case ">":
      return observedCents > thresholdCents
    case "<":
      return observedCents < thresholdCents
    case ">=":
      return observedCents >= thresholdCents
    case "<=":
      return observedCents <= thresholdCents
    case "==":
      return observedCents === thresholdCents
    case "!=":
      return observedCents !== thresholdCents
  }
}

export type MonitorTransition = "breach" | "clear" | "none"

/** Edge detection between the stored state and the freshly evaluated one. */
export function monitorTransition(wasBreached: boolean, nowBreached: boolean): MonitorTransition {
  if (!wasBreached && nowBreached) return "breach"
  if (wasBreached && !nowBreached) return "clear"
  return "none"
}

/** Dollars (ledger NUMERIC) → integer cents, without float drift. */
export function dollarsToCents(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot convert non-finite amount to cents: ${amount}`)
  }
  return Math.round(n * 100)
}
