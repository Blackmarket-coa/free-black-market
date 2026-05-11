/**
 * Quarterly patronage allocation computation.
 *
 * Patronage refund = (commission paid by seller in period) /
 *                    (total commission paid in period) ×
 *                    allocated refund pool
 *
 * Pure function — no DB access. The caller supplies the per-seller
 * commission contributions and the pool size; this returns the
 * allocation list ready to be persisted as `PatronageAllocation` rows.
 *
 * See `docs/COMPOSITION_LAYER.md` and `docs/POSTURE_A_COMPLIANCE.md` on
 * Subchapter T accounting cleanliness for patronage.
 */

export type SellerCommissionContribution = {
  seller_id: string
  commission_paid: number
}

export type PatronageComputationInput = {
  period_start: Date
  period_end: Date
  period_key: string
  pool_amount: number
  pool_currency: string
  contributions: SellerCommissionContribution[]
}

export type PatronageAllocationDraft = {
  seller_id: string
  period_start: Date
  period_end: Date
  period_key: string
  gross_volume: number
  allocation_amount: number
  allocation_currency: string
}

const ROUND = (n: number): number => Math.round(n * 100) / 100

export const computePatronageAllocations = (
  input: PatronageComputationInput
): PatronageAllocationDraft[] => {
  const totalCommission = input.contributions.reduce(
    (sum, c) => sum + Math.max(0, c.commission_paid),
    0
  )

  if (totalCommission <= 0) return []
  if (input.pool_amount <= 0) return []

  // Compute proportional shares, drop zero-contribution sellers.
  const positives = input.contributions.filter((c) => c.commission_paid > 0)

  const raw = positives.map((c) => {
    const share = c.commission_paid / totalCommission
    return {
      seller_id: c.seller_id,
      period_start: input.period_start,
      period_end: input.period_end,
      period_key: input.period_key,
      gross_volume: ROUND(c.commission_paid),
      allocation_amount: ROUND(input.pool_amount * share),
      allocation_currency: input.pool_currency,
    }
  })

  // Reconcile rounding drift: assign any residual cents to the largest
  // contributor so the sum exactly matches the pool amount.
  if (raw.length > 0) {
    const allocated = raw.reduce((s, r) => s + r.allocation_amount, 0)
    const residual = ROUND(input.pool_amount - allocated)
    if (residual !== 0) {
      const largestIdx = raw.reduce(
        (bestIdx, r, idx) =>
          r.allocation_amount > raw[bestIdx].allocation_amount ? idx : bestIdx,
        0
      )
      raw[largestIdx].allocation_amount = ROUND(
        raw[largestIdx].allocation_amount + residual
      )
    }
  }

  return raw
}

/**
 * Derive the quarter key (e.g. "2026-Q2") for a given date.
 */
export const quarterKey = (d: Date): string => {
  const month = d.getUTCMonth() // 0-11
  const q = Math.floor(month / 3) + 1
  return `${d.getUTCFullYear()}-Q${q}`
}

/**
 * Inclusive boundaries of the calendar quarter that contains `d`.
 * Returns `[start, end)` where end is the start of the next quarter.
 */
export const quarterBounds = (d: Date): { start: Date; end: Date } => {
  const month = d.getUTCMonth()
  const quarterStartMonth = Math.floor(month / 3) * 3
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), quarterStartMonth, 1, 0, 0, 0, 0)
  )
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 1, 0, 0, 0, 0)
  )
  return { start, end }
}
