import type { RevenueSummary } from "../types"

/**
 * A minimal shape of a hawala-ledger transaction-history entry, as returned by
 * `HawalaLedgerModuleService.getTransactionHistory()`. We only depend on the
 * fields we read so this stays testable without the full ledger.
 */
export interface LedgerHistoryEntry {
  direction: "CREDIT" | "DEBIT"
  entry_type: string
  /** Amount in MAJOR units (dollars) — the hawala ledger stores dollars. */
  signed_amount?: number
  amount?: number | string
  created_at?: string | Date
  status?: string
}

export interface RevenueComputeOptions {
  currency?: string
  /** "now" reference for last-30d / avg-daily windows (defaults to latest entry). */
  asOf?: Date
  source?: string
}

/**
 * Compute a vendor's revenue summary from ledger entries.
 *
 * Revenue = entries that are a CREDIT of type PURCHASE — the exact filter
 * `hawala-ledger`'s own `getVendorDashboard` uses. This is the ONLY definition
 * of vendor revenue in the quest engine; any figure that reaches an external
 * application reconciles to this, so a lender packet's income statement equals
 * the ledger (asserted by the reconciliation test). We NEVER create a parallel
 * un-reconciled total.
 *
 * Pure and deterministic: given the same entries + asOf it returns the same
 * result (no wall-clock reads), which is what makes it reconcilable and testable.
 */
export function computeRevenueSummary(
  entries: LedgerHistoryEntry[],
  opts: RevenueComputeOptions = {}
): RevenueSummary {
  const currency = opts.currency ?? "usd"
  const source = opts.source ?? "hawala-ledger:CREDIT+PURCHASE"

  const revenueEntries = entries.filter(
    (e) => e.direction === "CREDIT" && e.entry_type === "PURCHASE"
  )

  const amountOf = (e: LedgerHistoryEntry): number => {
    if (typeof e.signed_amount === "number") return e.signed_amount
    const raw = typeof e.amount === "string" ? parseFloat(e.amount) : e.amount
    return Number(raw ?? 0)
  }

  const dateOf = (e: LedgerHistoryEntry): Date | null => {
    if (!e.created_at) return null
    const d = e.created_at instanceof Date ? e.created_at : new Date(e.created_at)
    return isNaN(d.getTime()) ? null : d
  }

  const lifetime = round2(revenueEntries.reduce((s, e) => s + amountOf(e), 0))

  // Reference point for windows: explicit asOf, else the latest entry date.
  const dates = revenueEntries.map(dateOf).filter(Boolean) as Date[]
  const asOf =
    opts.asOf ??
    (dates.length
      ? new Date(Math.max(...dates.map((d) => d.getTime())))
      : null)

  let last30 = 0
  const monthly = new Map<string, number>()
  let firstDate: Date | null = null

  for (const e of revenueEntries) {
    const d = dateOf(e)
    const amt = amountOf(e)
    if (d) {
      if (!firstDate || d < firstDate) firstDate = d
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      monthly.set(key, (monthly.get(key) ?? 0) + amt)
      if (asOf) {
        const ageDays = (asOf.getTime() - d.getTime()) / 86_400_000
        if (ageDays >= 0 && ageDays <= 30) last30 += amt
      }
    }
  }

  const spanDays =
    firstDate && asOf
      ? Math.max(1, (asOf.getTime() - firstDate.getTime()) / 86_400_000)
      : 1
  const avgDaily = round2(lifetime / spanDays)

  const monthlySorted = [...monthly.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, revenue]) => ({ month, revenue: round2(revenue) }))

  return {
    currency,
    lifetime_revenue: lifetime,
    last_30d_revenue: round2(last30),
    avg_daily_revenue: avgDaily,
    monthly: monthlySorted,
    source,
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
