import type { PartnerOrg } from "@/lib/data/partners"

/**
 * The verification badge for a pilot-partner org on /partners.
 *
 * Every state has its own copy and the IRS file's own date, and nothing here
 * falls back to the enum key: showing a third party's tax status is legal
 * checkpoint L11 (docs/legal/checkpoints.md), so the words are chosen, not
 * derived. Three of them are deliberate:
 *
 * - `not_found` is "not confirmed in the IRS file dated X", never "not a
 *   charity" — churches and group-ruling subordinates are eligible and
 *   unlisted.
 * - `bmf_only` says "not in Pub 78" and nothing about deductibility; a
 *   501(c)(4) lands here by design.
 * - `coop` / `unincorporated` are not an IRS matter at all, so the badge
 *   says so and carries no date.
 *
 * Counsel reviews this copy before FF_NONPROFIT_PARITY_V1 is turned on.
 */
export type PartnerOrgBadgeTone = "affirmed" | "neutral" | "caution"

export type PartnerOrgBadge = {
  label: string
  tone: PartnerOrgBadgeTone
}

/**
 * The IRS file's date as a day, in UTC so the same file never shows two dates
 * on either side of midnight. Null when the value is missing or unparseable.
 */
export function formatIrsFileDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

const PENDING: PartnerOrgBadge = { label: "Verification pending", tone: "neutral" }

export function partnerOrgBadge(
  org: Pick<PartnerOrg, "org_type" | "verification_status" | "verified_as_of">
): PartnerOrgBadge {
  if (org.org_type === "coop" || org.org_type === "unincorporated") {
    return { label: "Not an IRS-exempt organisation type", tone: "neutral" }
  }

  const date = formatIrsFileDate(org.verified_as_of)

  switch (org.verification_status) {
    case "pub78_eligible":
      // A dated state without its file date is not a state we can describe
      // truthfully (L11: every status names the IRS file it came from), so it
      // reads as pending rather than as an undated claim. applyIrsLookup never
      // writes one, so this is a guard, not a path.
      if (!date) return PENDING
      return { label: `IRS Pub 78 eligible as of ${date}`, tone: "affirmed" }
    case "bmf_only":
      if (!date) return PENDING
      return {
        label: `IRS-listed exempt organisation (not in Pub 78) as of ${date}`,
        tone: "affirmed",
      }
    case "not_found":
      if (!date) return PENDING
      return { label: `Status not confirmed in the IRS file dated ${date}`, tone: "caution" }
    case "revoked":
      if (!date) return PENDING
      return { label: `Exemption revoked (IRS list dated ${date})`, tone: "caution" }
    case "pending":
    case "unverified":
    default:
      return PENDING
  }
}
