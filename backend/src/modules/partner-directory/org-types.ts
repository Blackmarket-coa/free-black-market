/**
 * Partner-org vocabularies — the single source of truth.
 *
 * The model, the migration, the admin zod schemas and the store serialiser
 * all import these arrays. `VendorType` is restated by hand in three places
 * (`seller-extension/models/seller-metadata.ts:23-29`) and has drifted; these
 * are exported once so that cannot happen here.
 *
 * Phase 1 of docs/BMC_SURVIVAL_PROGRAMS.md. Legal checkpoint L11
 * (docs/legal/checkpoints.md): surfacing a third party's IRS status is BMC
 * asserting something about another organisation, so the verification
 * vocabulary keeps states apart that a careless UI would collapse.
 */

export const PARTNER_ORG_TYPES = ["irs_501c3", "irs_501c4", "coop", "unincorporated"] as const
export type PartnerOrgType = (typeof PARTNER_ORG_TYPES)[number]

/**
 * Verification state, written only by the IRS ingest (never from an admin body).
 *
 * - `unverified`     never checked; the IRS has not been asked.
 * - `pending`        a check has been requested and has not completed.
 * - `pub78_eligible` present in IRS Publication 78 (eligible to receive
 *                    deductible contributions) as of the file date.
 * - `bmf_only`       present in the Exempt Organizations Business Master File
 *                    but not in Pub 78 — a 501(c)(4) is here by design.
 * - `not_found`      the EIN was not in the files consulted. This is NOT
 *                    "not a charity"; it is a different state (L11).
 * - `revoked`        on the Automatic Revocation list. Its own state; never
 *                    collapsed into `not_found` or `unverified`.
 */
export const PARTNER_ORG_VERIFICATION = [
  "unverified",
  "pending",
  "pub78_eligible",
  "bmf_only",
  "not_found",
  "revoked",
] as const
export type PartnerOrgVerification = (typeof PARTNER_ORG_VERIFICATION)[number]

/**
 * How the org sits in a host + collective pair (docs/reuse/04-partner-platforms.md §7).
 * A `sponsored_collective` points at its host by `fiscal_host_key`; a
 * `fiscal_host` can be verified once and shared by several collectives.
 */
export const PARTNER_ORG_RELATIONSHIP = ["standalone", "fiscal_host", "sponsored_collective"] as const
export type PartnerOrgRelationship = (typeof PARTNER_ORG_RELATIONSHIP)[number]

/** States an IRS file has affirmed. Publishing an IRS org type requires one of these. */
export const IRS_AFFIRMED_VERIFICATION: ReadonlySet<PartnerOrgVerification> = new Set<PartnerOrgVerification>([
  "pub78_eligible",
  "bmf_only",
])

/** Org types the IRS files have no opinion on; publication needs an explicit operator ack instead. */
export const NON_IRS_ORG_TYPES: ReadonlySet<PartnerOrgType> = new Set<PartnerOrgType>(["coop", "unincorporated"])

/**
 * Columns only the IRS ingest writes. The admin body schema rejects them and
 * the service strips them from every create/update as a second line — contrast
 * `api/admin/donations/beneficiaries/route.ts:36,56`, which takes
 * `verification_status` straight from the body.
 */
export const PARTNER_ORG_VERIFICATION_FIELDS = [
  "verification_status",
  "verification_source",
  "verified_as_of",
  "verification_checked_at",
] as const
export type PartnerOrgVerificationField = (typeof PARTNER_ORG_VERIFICATION_FIELDS)[number]

export type PublishRefusalCode = "org_type_required" | "unverified_irs_org" | "unverified_ack_required"

export type PublishRefusal = {
  code: PublishRefusalCode
  message: string
}

/**
 * Surfaced with every successful publish. The record carries no contract
 * state, so the route says what it cannot check (legal checkpoint L18).
 */
export const PUBLISH_MOU_NOTICE =
  "Publication presumes a signed pilot MOU with this organisation (legal checkpoint L18, docs/legal/checkpoints.md). " +
  "This record carries no contract state; confirm the MOU exists before relying on published: true."

/**
 * Why `published: true` is refused for this org, or `null` when it may be published.
 *
 * Pure. The service calls it on every write that would leave the row
 * published; the admin route only relays the answer. Rules, in order:
 *
 * 1. An IRS-affirmed status (`pub78_eligible`, `bmf_only`) publishes for any
 *    org type — the IRS file is the evidence.
 * 2. No `org_type` cannot publish: the record cannot say what it is.
 * 3. `coop` / `unincorporated`: the IRS has no file to consult, so the
 *    operator must acknowledge publishing without one, per request.
 * 4. `501c3` / `501c4` without an affirmed status are refused. The system
 *    surfaces L11 here and does not decide it: an admin cannot type the
 *    status in, and an unverified IRS org type does not go public.
 */
export function publishRefusal(
  org: { org_type: PartnerOrgType | null | undefined; verification_status: PartnerOrgVerification | null | undefined },
  opts: { publish_unverified_ack?: boolean } = {}
): PublishRefusal | null {
  const status = org.verification_status ?? "unverified"
  if (IRS_AFFIRMED_VERIFICATION.has(status)) return null

  if (!org.org_type) {
    return {
      code: "org_type_required",
      message: "Set org_type before publishing; the record cannot be published without saying what kind of organisation it is.",
    }
  }

  if (NON_IRS_ORG_TYPES.has(org.org_type)) {
    if (opts.publish_unverified_ack === true) return null
    return {
      code: "unverified_ack_required",
      message:
        `An org of type ${org.org_type} has no IRS file to verify against. ` +
        "Publishing it requires publish_unverified_ack: true on this request, acknowledging that counsel has signed off on listing a non-IRS organisation.",
    }
  }

  return {
    code: "unverified_irs_org",
    message:
      `An org of type ${org.org_type} cannot be published while verification_status is ${status}. ` +
      "Verification is written only by the IRS-file ingest; publishing an IRS org type the files have not affirmed would be BMC asserting its tax status (legal checkpoint L11).",
  }
}

/**
 * Normalise an EIN to nine digits, zero-padded. Accepts `12-3456789`,
 * `123456789`, and a leading-zero-stripped spreadsheet value (`12345678`).
 * Returns `null` for anything that is not 7-9 digits once punctuation is gone.
 */
export function normaliseEin(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const digits = String(input).replace(/[\s-]/g, "")
  if (!/^\d{7,9}$/.test(digits)) return null
  return digits.padStart(9, "0")
}
