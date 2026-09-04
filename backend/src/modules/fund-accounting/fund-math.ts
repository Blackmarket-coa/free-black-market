/**
 * Fund arithmetic and compliance tests — pure, I/O-free.
 *
 * Everything a grant report has to assert lives here so it can be tested
 * exhaustively without a database: what is left of an award, what cash is
 * actually in hand, and whether any spend broke the donor's intent.
 *
 * Balances are always derived from transaction rows. Nothing is cached on the
 * fund, so a fund can never disagree with its own history.
 */

import { FundRestriction } from "./models/fund"
import { FundEntryType } from "./models/fund-transaction"

/** Minimum shape the math needs. Real model rows satisfy it. */
export interface FundEntry {
  id?: string
  entry_type: FundEntryType | string
  amount_cents: number | string | bigint
  occurred_at?: Date | string | null
  program_id?: string | null
}

/** Minimum fund shape the compliance test needs. */
export interface FundTerms {
  restriction: FundRestriction | string
  designated_program_id?: string | null
  spend_from?: Date | string | null
  spend_until?: Date | string | null
  enforce_spend_limit?: boolean | null
}

export interface FundRollup {
  awarded_cents: number
  received_cents: number
  spent_cents: number
  released_cents: number
  returned_cents: number
  /** Awarded but not yet in hand. */
  receivable_cents: number
  /** How much of the award is still available to commit. */
  unspent_award_cents: number
  /** Cash actually on hand for this fund. */
  cash_available_cents: number
  entry_count: number
}

export type ViolationCode =
  | "overspent"
  | "over_received"
  | "off_purpose"
  | "untagged_spend"
  | "out_of_period"
  | "permanent_corpus_spent"

export interface FundViolation {
  code: ViolationCode
  severity: "error" | "warning"
  message: string
  /** The offending row, when the violation is attributable to one. */
  transaction_id?: string
  amount_cents?: number
}

function toCents(value: number | string | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "bigint" ? Number(value) : Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Purpose-restricted funds must be spent on their designated program. */
export function isPurposeRestricted(restriction: FundRestriction | string): boolean {
  return (
    restriction === FundRestriction.PURPOSE ||
    restriction === FundRestriction.PURPOSE_AND_TIME
  )
}

/** Time-restricted funds must be spent inside their stated window. */
export function isTimeRestricted(restriction: FundRestriction | string): boolean {
  return (
    restriction === FundRestriction.TIME ||
    restriction === FundRestriction.PURPOSE_AND_TIME
  )
}

/**
 * Sums transactions into a fund's balances. Negative rows are reversing
 * entries of their own type and simply reduce that bucket, which is why no
 * figure here is clamped at zero: a fund whose only row is a reversal should
 * read negative and be visibly wrong, not quietly read as empty.
 */
export function rollupFund(entries: readonly FundEntry[]): FundRollup {
  let awarded_cents = 0
  let received_cents = 0
  let spent_cents = 0
  let released_cents = 0
  let returned_cents = 0

  for (const entry of entries) {
    const amount = toCents(entry.amount_cents)
    switch (entry.entry_type) {
      case FundEntryType.AWARD:
        awarded_cents += amount
        break
      case FundEntryType.RECEIPT:
        received_cents += amount
        break
      case FundEntryType.EXPENDITURE:
        spent_cents += amount
        break
      case FundEntryType.RELEASE:
        released_cents += amount
        break
      case FundEntryType.RETURN:
        returned_cents += amount
        break
      default:
        // An entry type from a newer migration must not silently land in a
        // bucket it does not belong to; it is counted only in entry_count.
        break
    }
  }

  return {
    awarded_cents,
    received_cents,
    spent_cents,
    released_cents,
    returned_cents,
    receivable_cents: awarded_cents - received_cents,
    unspent_award_cents: awarded_cents - spent_cents - returned_cents,
    cash_available_cents: received_cents - spent_cents - returned_cents,
    entry_count: entries.length,
  }
}

/**
 * How much more may be spent against a fund. Null means "not limited here" —
 * either the fund does not enforce a spend limit, or it is a permanent fund
 * whose corpus is never spendable and is reported as a violation instead.
 */
export function spendHeadroomCents(
  fund: FundTerms,
  rollup: FundRollup
): number | null {
  if (fund.enforce_spend_limit === false) return null
  return rollup.unspent_award_cents
}

/**
 * Whether a date falls inside a fund's spend window. Unbounded on either side
 * when the corresponding bound is null. A missing date cannot be verified, so
 * it is treated as outside the window and surfaced rather than assumed fine.
 */
export function isWithinSpendPeriod(
  fund: FundTerms,
  when: Date | string | null | undefined
): boolean {
  const d = toDate(when)
  if (!d) return false
  const from = toDate(fund.spend_from)
  const until = toDate(fund.spend_until)
  if (from && d < from) return false
  if (until && d > until) return false
  return true
}

/**
 * Every way a fund's history breaks its donor's intent.
 *
 * Returns findings rather than throwing, because a report has to show all of
 * them at once — an organisation preparing a grant reconciliation needs the
 * full list, not the first failure.
 */
export function checkCompliance(
  fund: FundTerms,
  entries: readonly FundEntry[]
): FundViolation[] {
  const violations: FundViolation[] = []
  const rollup = rollupFund(entries)

  if (rollup.spent_cents + rollup.returned_cents > rollup.awarded_cents) {
    violations.push({
      code: "overspent",
      severity: "error",
      message: `Spent and returned ${rollup.spent_cents + rollup.returned_cents} cents against an award of ${rollup.awarded_cents} cents`,
      amount_cents:
        rollup.spent_cents + rollup.returned_cents - rollup.awarded_cents,
    })
  }

  if (rollup.received_cents > rollup.awarded_cents) {
    violations.push({
      code: "over_received",
      severity: "warning",
      message: `Received ${rollup.received_cents} cents against an award of ${rollup.awarded_cents} cents`,
      amount_cents: rollup.received_cents - rollup.awarded_cents,
    })
  }

  const purposeRestricted = isPurposeRestricted(fund.restriction)
  const timeRestricted = isTimeRestricted(fund.restriction)
  const permanent = fund.restriction === FundRestriction.PERMANENT

  for (const entry of entries) {
    if (entry.entry_type !== FundEntryType.EXPENDITURE) continue
    const amount = toCents(entry.amount_cents)
    // Reversing entries undo a spend; they cannot themselves break intent.
    if (amount <= 0) continue

    if (permanent) {
      violations.push({
        code: "permanent_corpus_spent",
        severity: "error",
        message: "Expenditure against a permanently restricted fund's corpus",
        transaction_id: entry.id,
        amount_cents: amount,
      })
    }

    if (purposeRestricted && fund.designated_program_id) {
      if (!entry.program_id) {
        // Not provably wrong, but not verifiable either — which is exactly
        // what fails an audit, so it is surfaced rather than passed.
        violations.push({
          code: "untagged_spend",
          severity: "warning",
          message:
            "Expenditure against a purpose-restricted fund carries no program_id",
          transaction_id: entry.id,
          amount_cents: amount,
        })
      } else if (entry.program_id !== fund.designated_program_id) {
        violations.push({
          code: "off_purpose",
          severity: "error",
          message: `Expenditure tagged program ${entry.program_id}, but the fund is designated for ${fund.designated_program_id}`,
          transaction_id: entry.id,
          amount_cents: amount,
        })
      }
    }

    if (timeRestricted && !isWithinSpendPeriod(fund, entry.occurred_at)) {
      violations.push({
        code: "out_of_period",
        severity: "error",
        message: "Expenditure falls outside the fund's permitted spend period",
        transaction_id: entry.id,
        amount_cents: amount,
      })
    }
  }

  return violations
}
