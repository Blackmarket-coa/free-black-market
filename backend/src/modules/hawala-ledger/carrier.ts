import {
  IRS_AFFIRMED_VERIFICATION,
  NON_IRS_ORG_TYPES,
  PARTNER_ORG_TYPES,
  PARTNER_ORG_VERIFICATION,
  type PartnerOrgType,
  type PartnerOrgVerification,
} from "../partner-directory/org-types"

/**
 * Nonprofit-carried investment pools (Posture A, Phase 1b).
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b and legal checkpoint L26
 * (docs/legal/checkpoints.md): every InvestmentPool is carried by a verified
 * nonprofit that holds and administers the funds ON ITS OWN ACCOUNTS. BMC
 * keeps the record and takes no custody. "A pool with no carrier cannot
 * accept money."
 *
 * The hawala-ledger counterpart of `donation/direct-split-guard.ts`, for the
 * same reason and in the same place: the service layer. hawala-ledger cannot
 * resolve PARTNER_DIRECTORY_MODULE from inside its own container, so — exactly
 * as the donation module freezes a recipient snapshot into
 * `donation_split_record` — the admin route resolves the directory, runs
 * `partnerOrgCarrierRefusal`, builds a `PoolCarrierSnapshot`, and the service
 * validates the snapshot's SHAPE here (`assertCarrierSnapshot`) before
 * writing. The service never trusts an unverified status in a snapshot: a
 * snapshot that would fail `publishRefusal` is refused here too (L11).
 *
 * What the service enforces with these helpers (service.ts):
 *
 *   - `createTransfer` refuses every leg that names a pool
 *     (`investment_pool_id`) or a PRODUCER_POOL account owned by a pool:
 *     reason `carried_pool` when the pool has a carrier (BMC never holds pool
 *     funds — always), reason `no_carrier` when it has none and
 *     FF_NONPROFIT_PARITY_V1 is on (the new rule, flag-gated so every
 *     existing path is byte-identical with the flag unset).
 *   - `createInvestment` and `distributeDividends` refuse a carried pool.
 *   - `recordCarrierContribution` / `recordCarrierDistribution` are the only
 *     money records on a carried pool: no ledger entry, no account, totals
 *     DERIVED from rows, idempotent on the carrier's reference.
 *
 * No new ledger vocabulary: no entry_type, no reference_type, no LedgerAccount
 * owner_type. The discriminator is `hawala_investment.settlement`.
 */

export type CarrierRefusalReason =
  /** FF_NONPROFIT_PARITY_V1 is not "true"; the write paths are dark. */
  | "feature_disabled"
  /** The pool has no carrier and the flag is on: it cannot accept money. */
  | "no_carrier"
  /** The pool is carried: BMC never holds pool funds, so no ledger leg. */
  | "carried_pool"
  /** A custody pool with funds in it cannot be relabelled as carried. */
  | "pool_has_ledger_funds"
  /** The carrier cannot change once CARRIER-settled records exist. */
  | "pool_has_carrier_records"
  /** The snapshot is malformed or does not describe a verified carrier. */
  | "invalid_carrier_snapshot"
  /** A record's amount or reference is not usable. */
  | "invalid_carrier_record"

export class CarrierRefusalError extends Error {
  constructor(
    public readonly reason: CarrierRefusalReason,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(`Pool carrier rule (${reason}): ${message} See docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b.`)
    this.name = "CarrierRefusalError"
  }
}

/**
 * What is frozen on the pool when a carrier is assigned (L11-dated). Dates are
 * ISO-8601 strings because the column is JSON; `verified_as_of` is the IRS
 * file's own date, `snapshot_at` when the admin route read the directory.
 */
export type PoolCarrierSnapshot = {
  org_key: string
  org_type: PartnerOrgType | null
  verification_status: PartnerOrgVerification
  verified_as_of: string | null
  /** The org had a Stripe connected account when assigned. Never the id itself. */
  stripe_connect_account_present: boolean
  snapshot_at: string
}

/** The pool projection every payload carries. Never the connected account. */
export type PoolCarrierProjection = {
  org_key: string
  verification_status: PartnerOrgVerification
  verified_as_of: string | null
}

type PoolLike = {
  carrier_org_key?: string | null
  carrier_snapshot?: unknown
}

export function isCarriedPool(pool: PoolLike | null | undefined): boolean {
  return typeof pool?.carrier_org_key === "string" && pool.carrier_org_key.length > 0
}

const ORG_TYPES: ReadonlySet<string> = new Set<string>(PARTNER_ORG_TYPES)
const VERIFICATIONS: ReadonlySet<string> = new Set<string>(PARTNER_ORG_VERIFICATION)

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime())
}

function carrierStatusEligible(orgType: PartnerOrgType | null, status: PartnerOrgVerification): boolean {
  if (IRS_AFFIRMED_VERIFICATION.has(status)) return true
  return orgType !== null && NON_IRS_ORG_TYPES.has(orgType)
}

/**
 * Validate a snapshot's shape and that it describes a carrier the directory
 * would have accepted. Returns the narrowed snapshot; throws
 * `CarrierRefusalError("invalid_carrier_snapshot")` naming the field otherwise.
 *
 *   - `org_key` non-empty;
 *   - `org_type` one of PARTNER_ORG_TYPES or null;
 *   - `verification_status` one of PARTNER_ORG_VERIFICATION, and eligible:
 *     IRS-affirmed (`pub78_eligible`, `bmf_only`) or a coop / unincorporated
 *     org — never `not_found`, `revoked`, `pending` or `unverified` on an IRS
 *     org type, and never a boolean "is charity" (L11);
 *   - an IRS-affirmed status carries the file's `verified_as_of` date;
 *   - `stripe_connect_account_present === true` (the carrier holds funds on
 *     its own accounts; the route checked the id, the snapshot records that);
 *   - `snapshot_at` a valid ISO date.
 */
export function assertCarrierSnapshot(input: unknown): PoolCarrierSnapshot {
  const fail = (field: string, why: string): never => {
    throw new CarrierRefusalError("invalid_carrier_snapshot", `${field}: ${why}`, { field })
  }
  if (!input || typeof input !== "object") return fail("snapshot", "must be an object")
  const s = input as Record<string, unknown>

  if (typeof s.org_key !== "string" || s.org_key.length === 0) fail("org_key", "must be a non-empty string")
  const orgType = s.org_type
  if (!(orgType === null || (typeof orgType === "string" && ORG_TYPES.has(orgType)))) {
    fail("org_type", `must be one of ${PARTNER_ORG_TYPES.join(", ")} or null`)
  }
  const status = s.verification_status
  if (typeof status !== "string" || !VERIFICATIONS.has(status)) {
    fail("verification_status", `must be one of ${PARTNER_ORG_VERIFICATION.join(", ")}`)
  }
  const verification = status as PartnerOrgVerification
  const type = orgType as PartnerOrgType | null
  if (!carrierStatusEligible(type, verification)) {
    fail(
      "verification_status",
      `${verification} on org_type ${type ?? "null"} is not IRS-affirmed and not a coop / unincorporated org; the pool would assert a tax status no file supports (L11)`
    )
  }
  if (!(s.verified_as_of === null || isIsoDate(s.verified_as_of))) {
    fail("verified_as_of", "must be an ISO date or null")
  }
  if (IRS_AFFIRMED_VERIFICATION.has(verification) && s.verified_as_of === null) {
    fail("verified_as_of", "an IRS-affirmed status must carry the IRS file's as-of date (L11)")
  }
  if (s.stripe_connect_account_present !== true) {
    fail("stripe_connect_account_present", "the carrier must hold funds on its own connected account")
  }
  if (!isIsoDate(s.snapshot_at)) fail("snapshot_at", "must be an ISO date")

  return {
    org_key: s.org_key as string,
    org_type: type,
    verification_status: verification,
    verified_as_of: (s.verified_as_of as string | null) ?? null,
    stripe_connect_account_present: true,
    snapshot_at: s.snapshot_at as string,
  }
}

/**
 * The carrier as every pool payload shows it, or null for an uncarried pool.
 * Reads the frozen snapshot (not the directory): what the pool was assigned
 * under, dated (L11). A pool whose snapshot is unreadable still names its
 * carrier; the status then reads `unverified` rather than being invented.
 */
export function projectPoolCarrier(pool: PoolLike | null | undefined): PoolCarrierProjection | null {
  if (!isCarriedPool(pool)) return null
  const snap = (pool!.carrier_snapshot ?? null) as Partial<PoolCarrierSnapshot> | null
  const status = snap?.verification_status
  return {
    org_key: pool!.carrier_org_key as string,
    verification_status: typeof status === "string" && VERIFICATIONS.has(status) ? status : "unverified",
    verified_as_of: isIsoDate(snap?.verified_as_of) ? snap!.verified_as_of! : null,
  }
}

/** The carrier columns no generated create/update may set. */
export const POOL_CARRIER_FIELDS = ["carrier_org_key", "carrier_snapshot"] as const

/**
 * Drop the carrier columns from any create/update input, whatever its shape
 * (one row, a list, or the `{ selector, data }` update form). A copy; the
 * caller's object is untouched.
 */
export function stripPoolCarrierFields<T>(input: T): T {
  if (Array.isArray(input)) return input.map((row) => stripPoolCarrierFields(row)) as unknown as T
  if (!input || typeof input !== "object") return input
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  for (const field of POOL_CARRIER_FIELDS) delete copy[field]
  if ("data" in copy && "selector" in copy) copy.data = stripPoolCarrierFields(copy.data)
  return copy as T
}

/** Major-unit amount with at most cents precision, positive and finite. */
export function isValidCarrierAmount(amount: unknown): amount is number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return false
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6
}

/** Sum a list of major-unit amounts in integer cents, back to major units. */
export function sumMajorUnits(amounts: Iterable<unknown>): number {
  let cents = 0
  for (const a of amounts) cents += Math.round(Number(a) * 100)
  return cents / 100
}
