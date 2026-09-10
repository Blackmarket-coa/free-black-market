/**
 * The operator review step between computing a patronage refund and paying it.
 *
 * `jobs/patronage-refund.ts` stops at `status=computed` and its docblock says
 * why: "so an operator can review before disbursement." Until now there was
 * nothing to review *with*. No route read a `PatronageAllocation`, nothing
 * wrote any status but `computed`, and a member had no way to learn that a
 * refund had been computed for them at all. A co-operative surplus returned in
 * proportion to how much someone traded is not returned if they never hear
 * about it.
 *
 * This module is the review, and it deliberately stops short of the money.
 * `computed → queued` is the operator's explicit act of approving a period's
 * allocation table; `queued → paid` belongs to a disbursement rail that does
 * not exist yet and whose shape is a Posture A question (USD payout goes via
 * the payment processor, not via Stellar — see `docs/POSTURE_A_COMPLIANCE.md`).
 * Approving moves no money. See docs/TRANSMUTATION_STRATEGY.md §5.5.
 *
 * Pure and container-free so the invariants can be tested directly.
 */

export const PATRONAGE_STATUSES = ["computed", "queued", "paid", "failed"] as const
export type PatronageStatus = (typeof PATRONAGE_STATUSES)[number]

export type PatronageAllocationRow = {
  id: string
  seller_id: string
  period_key: string
  gross_volume: number
  allocation_amount: number
  allocation_currency: string
  status: string
}

export type PatronagePeriodSummary = {
  period_key: string
  allocation_count: number
  seller_count: number
  total_allocated: number
  currency: string | null
  by_status: Record<string, number>
  /** True when at least one row is still `computed` and so can be approved. */
  approvable: boolean
}

/** Raised when a period cannot be approved. */
export class PatronageApprovalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PatronageApprovalError"
  }
}

/**
 * Summarise a period's allocation table for review.
 *
 * The totals are the point: an operator approving a disbursement should see
 * what it comes to before approving it, not a page of rows to add up.
 */
export function summarisePeriod(
  period_key: string,
  rows: readonly PatronageAllocationRow[]
): PatronagePeriodSummary {
  const by_status: Record<string, number> = {}
  for (const row of rows) {
    by_status[row.status] = (by_status[row.status] ?? 0) + 1
  }

  const currencies = new Set(rows.map((r) => r.allocation_currency))

  return {
    period_key,
    allocation_count: rows.length,
    seller_count: new Set(rows.map((r) => r.seller_id)).size,
    total_allocated: rows.reduce((sum, r) => sum + Number(r.allocation_amount ?? 0), 0),
    // Null rather than a guess when a period somehow mixes currencies: a
    // single total across two currencies is a wrong number, not a rounded one.
    currency: currencies.size === 1 ? [...currencies][0] : null,
    by_status,
    approvable: rows.some((r) => r.status === "computed"),
  }
}

/**
 * The rows an approval would move, and the reason if it cannot happen.
 *
 * Only `computed` rows transition. Re-approving a period is a no-op on the
 * rows already queued rather than an error, so a retried request after a
 * partial failure finishes the job instead of refusing it — but a period with
 * nothing left to approve is reported as such rather than silently succeeding.
 */
export function planApproval(
  period_key: string,
  rows: readonly PatronageAllocationRow[]
): { toQueue: PatronageAllocationRow[]; alreadyQueued: number; paid: number } {
  if (rows.length === 0) {
    throw new PatronageApprovalError(
      `No patronage allocations computed for ${period_key}. Nothing to approve.`
    )
  }

  const toQueue = rows.filter((r) => r.status === "computed")
  const alreadyQueued = rows.filter((r) => r.status === "queued").length
  const paid = rows.filter((r) => r.status === "paid").length

  if (toQueue.length === 0) {
    throw new PatronageApprovalError(
      `Every allocation for ${period_key} has already left the computed state ` +
        `(${alreadyQueued} queued, ${paid} paid). Approving again would do nothing.`
    )
  }

  return { toQueue, alreadyQueued, paid }
}

/**
 * A single allocation as a member should see it.
 *
 * `queued` is rendered as approved-but-unpaid rather than as a payment, since
 * no disbursement rail exists yet: telling a vendor money is on its way when
 * nothing will move it is the kind of claim this codebase keeps having to
 * retract.
 */
export function memberView(row: PatronageAllocationRow & { paid_at?: Date | string | null }) {
  const explanation: Record<string, string> = {
    computed: "Calculated from the commission you paid this period. Awaiting operator review.",
    queued: "Reviewed and approved. Not yet paid — disbursement is not automated yet.",
    paid: "Paid.",
    failed: "A payment attempt failed. The operator has been notified.",
  }

  return {
    period_key: row.period_key,
    gross_volume: row.gross_volume,
    allocation_amount: row.allocation_amount,
    allocation_currency: row.allocation_currency,
    status: row.status,
    paid_at: row.paid_at ?? null,
    explanation: explanation[row.status] ?? "Status unrecognised; contact support.",
  }
}
