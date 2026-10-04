import { HAWALA_LEDGER_MODULE } from "../hawala-ledger"
import {
  IRS_AFFIRMED_VERIFICATION,
  NON_IRS_ORG_TYPES,
  type PartnerOrgType,
  type PartnerOrgVerification,
} from "../partner-directory/org-types"
import {
  findForbiddenDirectChargeParams,
  isStripeAccountId,
} from "../../shared/stripe-direct-charge"
import { DONATION_SPLIT_KINDS, type DonationSplitKind, type DonationSplitStatus } from "./models/donation-split-record"

/**
 * Direct-split invariants (Posture A, donations).
 *
 * The donation counterpart of `hawala-ledger/posture-a-guard.ts`, for the same
 * reason and in the same place: the service layer. Workflow hooks and route
 * handlers can be bypassed; `DonationModuleService.recordDirectSplit` and
 * `applyDirectSplitProcessorEvent` are the only writers of
 * `donation_split_record` that run this guard, and both call
 * `assertDirectSplitInvariants` before the write. `MedusaService` also
 * generates `createDonationSplitRecords` / `updateDonationSplitRecords` on
 * the same class; they are persistence, not an API, and nothing may call
 * them directly — the DB CHECKs (`bmc_fee_cents = 0`, `gross_cents > 0`,
 * `refunded_cents` bounded) are the only rules that survive such a call.
 * Strict only — there is no warn or off mode, because the thing being
 * asserted is a legal boundary (docs/POSTURE_A_COMPLIANCE.md rule 10; legal
 * checkpoints L11, L24), not an operational preference.
 *
 * What must be true of every record written:
 *
 *   1. The charge is ON a connected account: `stripe_account_id` is an
 *      `acct_…` id. That is the direct-charge shape — funds settle on the
 *      org's own Stripe balance and never transit FBM's (L24).
 *   2. The intent carries none of `transfer_data`, `on_behalf_of`,
 *      `application_fee_amount` at any depth (`shared/stripe-direct-charge.ts`).
 *      Those are the shapes that route money through the platform.
 *   3. `bmc_fee_cents === 0`. The transaction-kind rung in
 *      `payout-breakdown/fee-resolution.ts` is why; the DB CHECK is the last
 *      line; this is the one that explains itself.
 *   4. The recipient snapshot is present and dated: a verification status, the
 *      time it was frozen, and — for an IRS org type — the IRS file's as-of
 *      date (L11). A snapshot that would fail `publishRefusal` is refused here
 *      too, so an unverified 501(c)(3) cannot be recorded as a recipient even
 *      if a caller skipped the route's eligibility check.
 *   5. The hawala ledger was never resolved in the flow that produced the
 *      record. Callers route every `container.resolve` through
 *      `traceResolutions`; a flow that touched `HAWALA_LEDGER_MODULE` is
 *      refused. A donation is not an order: no ESCROW → seller leg, no
 *      `processOrderPayment`, no `processRefund`.
 *   6. `kind` is `donation` or `donation_pledge`; `gross_cents` is a positive
 *      integer (integer cents, never a float).
 */

export type DirectSplitViolationCode =
  | "not_on_connected_account"
  | "forbidden_intent_param"
  | "nonzero_bmc_fee"
  | "gross_not_positive_integer"
  | "kind_not_donation"
  | "recipient_snapshot_missing"
  | "recipient_as_of_missing"
  | "recipient_not_eligible"
  | "hawala_ledger_resolved"
  | "account_mismatch"

export class DirectSplitViolationError extends Error {
  constructor(
    public readonly code: DirectSplitViolationCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(`Direct-split invariant violated (${code}): ${message} See docs/POSTURE_A_COMPLIANCE.md rule 10.`)
    this.name = "DirectSplitViolationError"
  }
}

/** The recipient fields frozen on a record at charge time (L11). */
export type RecipientSnapshot = {
  recipient_org_type: PartnerOrgType | null
  recipient_verification_status: PartnerOrgVerification
  recipient_verified_as_of: Date | null
  recipient_snapshot_at: Date
}

/** What the guard reads off a record about to be written. */
export type DirectSplitRecordShape = RecipientSnapshot & {
  stripe_payment_intent_id: string
  stripe_account_id: string
  org_key: string
  kind: DonationSplitKind
  gross_cents: number
  bmc_fee_cents: number
  status?: DonationSplitStatus
}

/** The intent as created or as Stripe returned it; only the forbidden keys are read. */
export type DirectChargeIntentShape = Record<string, unknown>

/** Which container keys a flow resolved. Produced by `traceResolutions`. */
export type DirectSplitFlowTrace = {
  resolved_module_keys: readonly string[]
}

export type DirectSplitGuardInput = {
  record: DirectSplitRecordShape
  intent: DirectChargeIntentShape
  flow: DirectSplitFlowTrace
}

/**
 * The org-level eligibility rule, pure. `null` when the org may receive a
 * direct-charge donation; otherwise why not. The route turns any non-null
 * answer into `forbidden()` (403, one shape, no existence oracle) and logs the
 * code server-side only.
 *
 * - must be published (an unpublished row is not a recipient the public can see);
 * - must have a connected account to charge ON;
 * - must be IRS-affirmed (`pub78_eligible`, `bmf_only`) — or be a coop /
 *   unincorporated org, which can only have been published with the
 *   operator's `publish_unverified_ack` already recorded (S5's guard).
 */
export type RecipientRefusalCode =
  | "not_found"
  | "not_published"
  | "no_connected_account"
  | "not_verified"

export function donationRecipientRefusal(
  org:
    | {
        published: boolean
        stripe_connect_account_id: string | null
        org_type: PartnerOrgType | null
        verification_status: PartnerOrgVerification
      }
    | null
    | undefined
): RecipientRefusalCode | null {
  if (!org) return "not_found"
  if (org.published !== true) return "not_published"
  if (!isStripeAccountId(org.stripe_connect_account_id)) return "no_connected_account"
  if (recipientStatusEligible(org.org_type, org.verification_status)) return null
  return "not_verified"
}

function recipientStatusEligible(orgType: PartnerOrgType | null, status: PartnerOrgVerification): boolean {
  if (IRS_AFFIRMED_VERIFICATION.has(status)) return true
  return orgType !== null && NON_IRS_ORG_TYPES.has(orgType)
}

/** Freeze what is true about the recipient now (L11). */
export function freezeRecipientSnapshot(
  org: {
    org_type: PartnerOrgType | null
    verification_status: PartnerOrgVerification
    verified_as_of: Date | null
  },
  at: Date
): RecipientSnapshot {
  return {
    recipient_org_type: org.org_type,
    recipient_verification_status: org.verification_status,
    recipient_verified_as_of: org.verified_as_of instanceof Date ? org.verified_as_of : null,
    recipient_snapshot_at: at,
  }
}

type Resolver = { resolve: <T = unknown>(key: string) => T }

/**
 * Wrap a container so every `resolve` is recorded. The guard's rule 5 reads
 * the trace. Nothing is cached or altered; the only thing added is memory.
 */
export function traceResolutions(scope: Resolver): Resolver & { readonly resolved: readonly string[] } {
  const resolved: string[] = []
  return {
    resolved,
    resolve<T = unknown>(key: string): T {
      resolved.push(key)
      return scope.resolve<T>(key)
    },
  }
}

export function assertDirectSplitInvariants({ record, intent, flow }: DirectSplitGuardInput): void {
  if (!isStripeAccountId(record.stripe_account_id)) {
    throw new DirectSplitViolationError(
      "not_on_connected_account",
      "a donation is collected only as a direct charge ON the recipient org's connected account (acct_…).",
      { stripe_account_id: record.stripe_account_id ?? null, org_key: record.org_key }
    )
  }

  const forbidden = findForbiddenDirectChargeParams(intent)
  if (forbidden.length > 0) {
    throw new DirectSplitViolationError(
      "forbidden_intent_param",
      `${forbidden.join(", ")} present: destination charges, on_behalf_of and application fees route funds through FBM's balance (L24).`,
      { forbidden, stripe_payment_intent_id: record.stripe_payment_intent_id }
    )
  }

  if (record.bmc_fee_cents !== 0) {
    throw new DirectSplitViolationError(
      "nonzero_bmc_fee",
      "BMC takes 0 on a donation by the transaction-kind rule; a record cannot say otherwise.",
      { bmc_fee_cents: record.bmc_fee_cents }
    )
  }

  if (!Number.isInteger(record.gross_cents) || record.gross_cents <= 0) {
    throw new DirectSplitViolationError(
      "gross_not_positive_integer",
      "gross_cents must be a positive integer number of cents.",
      { gross_cents: record.gross_cents }
    )
  }

  if (!(DONATION_SPLIT_KINDS as readonly string[]).includes(record.kind)) {
    throw new DirectSplitViolationError("kind_not_donation", "only `donation` and `donation_pledge` are recorded here.", {
      kind: record.kind,
    })
  }

  if (
    typeof record.recipient_verification_status !== "string" ||
    record.recipient_verification_status.length === 0 ||
    !(record.recipient_snapshot_at instanceof Date) ||
    Number.isNaN(record.recipient_snapshot_at.getTime())
  ) {
    throw new DirectSplitViolationError(
      "recipient_snapshot_missing",
      "the recipient's verification status and the time it was frozen must be on the record (L11).",
      { org_key: record.org_key }
    )
  }

  if (!recipientStatusEligible(record.recipient_org_type, record.recipient_verification_status)) {
    throw new DirectSplitViolationError(
      "recipient_not_eligible",
      "the recipient snapshot is not IRS-affirmed and not a coop / unincorporated org; the record would assert a tax status no file supports (L11).",
      { org_key: record.org_key, recipient_org_type: record.recipient_org_type, recipient_verification_status: record.recipient_verification_status }
    )
  }

  if (
    IRS_AFFIRMED_VERIFICATION.has(record.recipient_verification_status) &&
    !(record.recipient_verified_as_of instanceof Date)
  ) {
    throw new DirectSplitViolationError(
      "recipient_as_of_missing",
      "an IRS-affirmed status must carry the IRS file's as-of date (L11).",
      { org_key: record.org_key, recipient_verification_status: record.recipient_verification_status }
    )
  }

  if (flow.resolved_module_keys.includes(HAWALA_LEDGER_MODULE)) {
    throw new DirectSplitViolationError(
      "hawala_ledger_resolved",
      "the hawala ledger was resolved in this flow; a donation is not an order and posts no ledger leg.",
      { resolved_module_keys: [...flow.resolved_module_keys] }
    )
  }
}
