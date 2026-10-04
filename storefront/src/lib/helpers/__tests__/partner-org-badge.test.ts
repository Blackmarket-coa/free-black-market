import { describe, expect, it } from "vitest"
import { formatIrsFileDate, partnerOrgBadge } from "../partner-org-badge"
import type { PartnerOrgType, PartnerOrgVerification } from "@/lib/data/partners"

/**
 * The badge copy is a legal surface (checkpoint L11): every state has its
 * own words and the IRS file's date, `not_found` never reads as "not a
 * charity", and no enum key ever reaches the page.
 */
const AS_OF = "2026-09-10T09:18:37.000Z"
const DATE = "September 10, 2026"

const STATUSES: PartnerOrgVerification[] = [
  "unverified",
  "pending",
  "pub78_eligible",
  "bmf_only",
  "not_found",
  "revoked",
]
const ORG_TYPES: Array<PartnerOrgType | null> = ["irs_501c3", "irs_501c4", "coop", "unincorporated", null]

describe("formatIrsFileDate", () => {
  it("renders the file date as a UTC day", () => {
    expect(formatIrsFileDate(AS_OF)).toBe(DATE)
    // Just before midnight UTC stays on its own day regardless of the host zone.
    expect(formatIrsFileDate("2026-09-30T23:59:59.000Z")).toBe("September 30, 2026")
  })

  it("is null for nothing or garbage, never a crash", () => {
    expect(formatIrsFileDate(null)).toBeNull()
    expect(formatIrsFileDate(undefined)).toBeNull()
    expect(formatIrsFileDate("")).toBeNull()
    expect(formatIrsFileDate("not a date")).toBeNull()
  })
})

describe("partnerOrgBadge", () => {
  it("pub78_eligible: eligible as of the file date", () => {
    expect(partnerOrgBadge({ org_type: "irs_501c3", verification_status: "pub78_eligible", verified_as_of: AS_OF })).toEqual({
      label: `IRS Pub 78 eligible as of ${DATE}`,
      tone: "affirmed",
    })
  })

  it("bmf_only: listed, explicitly not in Pub 78, nothing about deductibility", () => {
    const badge = partnerOrgBadge({ org_type: "irs_501c4", verification_status: "bmf_only", verified_as_of: AS_OF })
    expect(badge).toEqual({
      label: `IRS-listed exempt organisation (not in Pub 78) as of ${DATE}`,
      tone: "affirmed",
    })
    expect(badge.label.toLowerCase()).not.toContain("deductib")
  })

  it("not_found: not confirmed in the file dated X — never 'not a charity'", () => {
    const badge = partnerOrgBadge({ org_type: "irs_501c3", verification_status: "not_found", verified_as_of: AS_OF })
    expect(badge).toEqual({
      label: `Status not confirmed in the IRS file dated ${DATE}`,
      tone: "caution",
    })
    expect(badge.label.toLowerCase()).not.toMatch(/not a charity|not eligible|not exempt/)
  })

  it("revoked: its own words and the revocation list's date", () => {
    expect(partnerOrgBadge({ org_type: "irs_501c3", verification_status: "revoked", verified_as_of: AS_OF })).toEqual({
      label: `Exemption revoked (IRS list dated ${DATE})`,
      tone: "caution",
    })
  })

  it("coop / unincorporated: not an IRS matter, no date, whatever the status says", () => {
    for (const org_type of ["coop", "unincorporated"] as const) {
      for (const verification_status of STATUSES) {
        expect(partnerOrgBadge({ org_type, verification_status, verified_as_of: AS_OF })).toEqual({
          label: "Not an IRS-exempt organisation type",
          tone: "neutral",
        })
      }
    }
  })

  it("unverified and pending: verification pending, no date", () => {
    for (const verification_status of ["unverified", "pending"] as const) {
      expect(partnerOrgBadge({ org_type: "irs_501c3", verification_status, verified_as_of: null })).toEqual({
        label: "Verification pending",
        tone: "neutral",
      })
    }
  })

  it("never lets an enum key or a null date reach the page", () => {
    for (const org_type of ORG_TYPES) {
      for (const verification_status of STATUSES) {
        for (const verified_as_of of [AS_OF, null]) {
          const { label } = partnerOrgBadge({ org_type, verification_status, verified_as_of })
          expect(label).not.toMatch(/_/) // no snake_case key leaks
          expect(label).not.toBe(verification_status) // never the bare key
          expect(label).not.toBe(org_type ?? "")
          expect(label).not.toMatch(/null|undefined|Invalid Date/)
          expect(label.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("a dated state with a missing date reads as pending rather than as an undated claim (L11)", () => {
    for (const verification_status of ["pub78_eligible", "bmf_only", "not_found", "revoked"] as const) {
      const badge = partnerOrgBadge({ org_type: "irs_501c3", verification_status, verified_as_of: null })
      expect(badge).toEqual({ label: "Verification pending", tone: "neutral" })
    }
  })
})
