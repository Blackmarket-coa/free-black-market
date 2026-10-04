import {
  assertCarrierSnapshot,
  CarrierRefusalError,
  isValidCarrierAmount,
  projectPoolCarrier,
  sumMajorUnits,
  type PoolCarrierProjection,
  type PoolCarrierSnapshot,
} from "./carrier"

/**
 * Verified nonprofit partner_orgs as VendorAdvance recipients (Posture A,
 * Phase 1b slice S13).
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a and legal checkpoint L26
 * (docs/legal/checkpoints.md): a verified nonprofit can be the recipient of a
 * VendorAdvance RECORD alongside sellers. For an org the advance is a record
 * of an operator-approved advance disbursed and repaid OUTSIDE the hawala
 * ledger — the org has no ledger account and must not get one (Posture A rule
 * 3: no balance-holding outside purchase -> payout; phase1-rules do_not_build:
 * no LedgerAccount, no owner_type value, no hawala entry). Money moves by an
 * operator action elsewhere (e.g. a Stripe transfer from BMC's own balance to
 * the org's connected account) whose reference is recorded on approval.
 *
 * What the service enforces with these helpers (service.ts):
 *
 *   - `requestOrgAdvance`: FF_NONPROFIT_PARITY_V1 on; a recipient snapshot
 *     that passes `assertCarrierSnapshot` (verified + published + connected
 *     account — the same predicate the pool carrier uses, so the two "verified
 *     org" rules cannot drift); an operator-supplied eligibility snapshot
 *     `{ basis, approved_limit }` — the operator IS the eligibility, BMC never
 *     fabricates one from sales metrics (`calculateAdvanceEligibility` is
 *     never called for an org); amount <= approved_limit; the row is
 *     PENDING_APPROVAL. No auto-approve. No ledger account, no ledger entry.
 *   - `approveOrgAdvance`: PENDING_APPROVAL -> ACTIVE on an explicit operator
 *     approval carrying the external `disbursement_reference`; idempotent on
 *     that reference (a replay with the same reference is a no-op answer, a
 *     different reference is refused).
 *   - `recordOrgAdvanceRepayment`: a MANUAL AdvanceRepayment idempotent on
 *     `external_reference` under a partial unique index; `outstanding_balance`
 *     and `total_repaid` are DERIVED from the rows, never incremented; REPAID
 *     when the derived outstanding reaches 0.
 *
 * Fee semantics copy the seller path's FACTOR_RATE (total owed = principal *
 * fee_rate) so the two paths do not diverge in meaning; `fee_cap` is still
 * ignored on both (pre-existing, recorded by the orchestrator).
 */

export type OrgAdvanceRefusalReason =
  /** FF_NONPROFIT_PARITY_V1 is not "true"; the org path is dark. */
  | "feature_disabled"
  /** The recipient snapshot is malformed, unverified, or names another org. */
  | "invalid_recipient_snapshot"
  /** The operator's eligibility snapshot is malformed. */
  | "invalid_eligibility"
  /** The requested amount exceeds the operator-approved limit. */
  | "over_limit"
  /** The amount, rate or term is not usable. */
  | "invalid_terms"
  /** The org already has an open (pending / approved / active) advance. */
  | "open_advance_exists"
  /** The advance named is not a PARTNER_ORG advance. */
  | "not_org_advance"
  /** The operation is not valid in the advance's current status. */
  | "invalid_state"
  /** A second approval carried a different disbursement reference. */
  | "reference_mismatch"
  /** A repayment's amount or reference is not usable, or exceeds what is owed. */
  | "invalid_repayment"

export class OrgAdvanceRefusalError extends Error {
  constructor(
    public readonly reason: OrgAdvanceRefusalReason,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(`Org advance rule (${reason}): ${message} See docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a.`)
    this.name = "OrgAdvanceRefusalError"
  }
}

/** The recipient snapshot frozen on a PARTNER_ORG advance: the pool carrier's shape (L11-dated). */
export type OrgAdvanceRecipientSnapshot = PoolCarrierSnapshot

/**
 * The operator's statement of why this org may be advanced this much. BMC
 * records the stated basis; it does not compute one. `approved_limit` is in
 * the advance tables' own unit (major units), like `principal_amount`.
 */
export type OrgAdvanceEligibilitySnapshot = {
  basis: string
  approved_limit: number
  recorded_by: string | null
  recorded_at: string
}

/** The same bounds the seller path's zod schema (`requestAdvanceSchema`) enforces. */
export const ORG_ADVANCE_FEE_RATE_MIN = 1
export const ORG_ADVANCE_FEE_RATE_MAX = 2
export const ORG_ADVANCE_TERM_DAYS_MIN = 7
export const ORG_ADVANCE_TERM_DAYS_MAX = 365

/** Statuses under which an org may not open another advance. */
export const OPEN_ADVANCE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "ACTIVE"] as const

/**
 * Validate the recipient snapshot the admin route built from the directory.
 * Delegates to `assertCarrierSnapshot` (same rules as a pool carrier), then
 * checks the snapshot names the org the request names. Rethrown under this
 * module's error class so a caller maps one vocabulary.
 */
export function assertOrgAdvanceRecipient(input: unknown, partnerOrgKey: string): OrgAdvanceRecipientSnapshot {
  let snapshot: PoolCarrierSnapshot
  try {
    snapshot = assertCarrierSnapshot(input)
  } catch (error) {
    if (error instanceof CarrierRefusalError) {
      throw new OrgAdvanceRefusalError("invalid_recipient_snapshot", error.message, error.details)
    }
    throw error
  }
  if (snapshot.org_key !== partnerOrgKey) {
    throw new OrgAdvanceRefusalError(
      "invalid_recipient_snapshot",
      `snapshot names ${snapshot.org_key}, the request names ${partnerOrgKey}.`,
      { snapshot_org_key: snapshot.org_key, partner_org_key: partnerOrgKey }
    )
  }
  return snapshot
}

/** `basis` non-empty; `approved_limit` a positive major-unit amount with at most cents precision. */
export function assertOrgAdvanceEligibility(
  input: unknown,
  recordedBy: string | null,
  at: Date
): OrgAdvanceEligibilitySnapshot {
  const fail = (field: string, why: string): never => {
    throw new OrgAdvanceRefusalError("invalid_eligibility", `${field}: ${why}`, { field })
  }
  if (!input || typeof input !== "object") return fail("eligibility", "must be an object")
  const e = input as Record<string, unknown>
  if (typeof e.basis !== "string" || e.basis.trim().length === 0) fail("basis", "must be a non-empty string")
  if (!isValidCarrierAmount(e.approved_limit)) {
    fail("approved_limit", "must be a positive, finite major-unit amount with at most two decimals")
  }
  return {
    basis: (e.basis as string).trim(),
    approved_limit: e.approved_limit as number,
    recorded_by: recordedBy,
    recorded_at: at.toISOString(),
  }
}

export function assertOrgAdvanceTerms(input: { amount: unknown; fee_rate: unknown; term_days: unknown }): {
  amount: number
  fee_rate: number
  term_days: number
} {
  const fail = (field: string, why: string): never => {
    throw new OrgAdvanceRefusalError("invalid_terms", `${field}: ${why}`, { field, value: input[field as keyof typeof input] })
  }
  if (!isValidCarrierAmount(input.amount)) {
    fail("amount", "must be a positive, finite major-unit amount with at most two decimals")
  }
  const rate = input.fee_rate
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < ORG_ADVANCE_FEE_RATE_MIN || rate > ORG_ADVANCE_FEE_RATE_MAX) {
    fail("fee_rate", `must be a factor rate between ${ORG_ADVANCE_FEE_RATE_MIN} and ${ORG_ADVANCE_FEE_RATE_MAX}`)
  }
  const term = input.term_days
  if (typeof term !== "number" || !Number.isInteger(term) || term < ORG_ADVANCE_TERM_DAYS_MIN || term > ORG_ADVANCE_TERM_DAYS_MAX) {
    fail("term_days", `must be an integer between ${ORG_ADVANCE_TERM_DAYS_MIN} and ${ORG_ADVANCE_TERM_DAYS_MAX}`)
  }
  return { amount: input.amount as number, fee_rate: rate as number, term_days: term as number }
}

/** A non-empty, trimmed external reference (the idempotency key), or a refusal under `reason`. */
export function requireReference(value: unknown, field: string, reason: OrgAdvanceRefusalReason): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrgAdvanceRefusalError(reason, `${field} is required: the record is keyed by the operator's own reference, never by the attempt.`, { field })
  }
  return value.trim()
}

/**
 * Total owed on a factor-rate advance, in integer cents then back to the
 * table's unit: principal * fee_rate, rounded to the cent once. The seller
 * path computes `data.amount * data.fee_rate` as a float; this is the same
 * number without the float residue.
 */
export function totalOwedMajorUnits(principal: number, feeRate: number): number {
  return Math.round(Math.round(principal * 100) * feeRate) / 100
}

/** Sum at the eight decimals `splitAdvanceRepayment` works in (its true-up needs the exact prior principal). */
function sumSplitUnits(amounts: Iterable<unknown>): number {
  let scaled = 0
  for (const a of amounts) scaled += Math.round(Number(a) * 1e8)
  return scaled / 1e8
}

/**
 * Derive an org advance's repayment position from its COMPLETED repayment
 * rows. Never `+=` on a stored counter: the rows are the record. The money
 * figures (`total_owed`, `total_repaid`, `outstanding_balance`) are cents;
 * the principal / fee components keep the split's eight decimals so the
 * closing payment trues up exactly.
 */
export function deriveOrgAdvancePosition(
  advance: { principal_amount: unknown; fee_rate: unknown },
  completedRepayments: Array<{ total_amount: unknown; principal_amount: unknown; fee_amount: unknown }>
): {
  total_owed: number
  total_repaid: number
  principal_repaid: number
  fee_repaid: number
  outstanding_balance: number
} {
  const totalOwed = totalOwedMajorUnits(Number(advance.principal_amount), Number(advance.fee_rate))
  const totalRepaid = sumMajorUnits(completedRepayments.map((r) => r.total_amount))
  return {
    total_owed: totalOwed,
    total_repaid: totalRepaid,
    principal_repaid: sumSplitUnits(completedRepayments.map((r) => r.principal_amount)),
    fee_repaid: sumSplitUnits(completedRepayments.map((r) => r.fee_amount)),
    outstanding_balance: Math.max(0, Math.round((totalOwed - totalRepaid) * 100) / 100),
  }
}

export function isOrgAdvance(advance: { recipient_type?: string | null } | null | undefined): boolean {
  return advance?.recipient_type === "PARTNER_ORG"
}

/** The recipient as every payload shows it: the pool-carrier projection over the frozen snapshot. */
export function projectOrgAdvanceRecipient(advance: {
  recipient_type?: string | null
  partner_org_key?: string | null
  recipient_snapshot?: unknown
}): PoolCarrierProjection | null {
  if (!isOrgAdvance(advance)) return null
  return projectPoolCarrier({ carrier_org_key: advance.partner_org_key, carrier_snapshot: advance.recipient_snapshot })
}
