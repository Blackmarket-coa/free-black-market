import { buildCarrierSnapshot, partnerOrgCarrierRefusal, type CarrierOrgShape } from "../carrier"
import { assertCarrierSnapshot, CarrierRefusalError, projectPoolCarrier } from "../../hawala-ledger/carrier"
import { PARTNER_ORG_TYPES, PARTNER_ORG_VERIFICATION } from "../org-types"

/**
 * The carrier predicate and snapshot (docs/BMC_SURVIVAL_PROGRAMS.md Decision
 * 6b; L11, L26), pinned without a route in front of them, the way
 * `donation/__tests__/posture-a-direct-split-invariants.unit.spec.ts` pins
 * `donationRecipientRefusal`. The two predicates must agree: both are "may
 * this org receive / hold money for the public", and a carrier that the
 * donation path would refuse is a carrier the pool path must refuse.
 */

const AS_OF = new Date("2026-09-10T09:18:37Z")
const SNAP_AT = new Date("2026-10-04T12:00:00Z")

const eligible = (over: Partial<CarrierOrgShape> = {}): CarrierOrgShape => ({
  key: "ground_up_liberation_project",
  published: true,
  stripe_connect_account_id: "acct_1GULP",
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  ...over,
})

describe("partnerOrgCarrierRefusal", () => {
  it("admits a published, IRS-affirmed org with a connected account, and a published coop / unincorporated org", () => {
    expect(partnerOrgCarrierRefusal(eligible())).toBeNull()
    expect(partnerOrgCarrierRefusal(eligible({ verification_status: "bmf_only", org_type: "irs_501c4" }))).toBeNull()
    expect(partnerOrgCarrierRefusal(eligible({ org_type: "coop", verification_status: "unverified" }))).toBeNull()
    expect(partnerOrgCarrierRefusal(eligible({ org_type: "unincorporated", verification_status: "unverified" }))).toBeNull()
  })

  it("refuses the missing, the unpublished, the account-less and the unverified, each by name — not_found and revoked are refused as themselves, never admitted", () => {
    expect(partnerOrgCarrierRefusal(null)).toBe("not_found")
    expect(partnerOrgCarrierRefusal(undefined)).toBe("not_found")
    expect(partnerOrgCarrierRefusal(eligible({ published: false }))).toBe("not_published")
    expect(partnerOrgCarrierRefusal(eligible({ stripe_connect_account_id: null }))).toBe("no_connected_account")
    expect(partnerOrgCarrierRefusal(eligible({ stripe_connect_account_id: "cus_1" }))).toBe("no_connected_account")
    for (const status of ["unverified", "pending", "not_found", "revoked"] as const) {
      expect(partnerOrgCarrierRefusal(eligible({ verification_status: status }))).toBe("not_verified")
      expect(partnerOrgCarrierRefusal(eligible({ org_type: "irs_501c4", verification_status: status }))).toBe("not_verified")
    }
    expect(partnerOrgCarrierRefusal(eligible({ org_type: null, verification_status: "unverified" }))).toBe("not_verified")
  })

  it("checks in order: publication before the account, the account before verification", () => {
    // An unpublished, account-less, revoked row is refused for being unpublished — the
    // first rule — so a caller logging the code learns the first thing to fix.
    expect(partnerOrgCarrierRefusal(eligible({ published: false, stripe_connect_account_id: null, verification_status: "revoked" }))).toBe("not_published")
    expect(partnerOrgCarrierRefusal(eligible({ stripe_connect_account_id: null, verification_status: "revoked" }))).toBe("no_connected_account")
  })

  it("walks the full truth table: every (type, status) pair is admitted iff IRS-affirmed or a non-IRS type", () => {
    for (const org_type of [...PARTNER_ORG_TYPES, null] as const) {
      for (const verification_status of PARTNER_ORG_VERIFICATION) {
        const want =
          verification_status === "pub78_eligible" || verification_status === "bmf_only" || org_type === "coop" || org_type === "unincorporated"
            ? null
            : "not_verified"
        expect(partnerOrgCarrierRefusal(eligible({ org_type, verification_status }))).toBe(want)
      }
    }
  })
})

describe("buildCarrierSnapshot → assertCarrierSnapshot", () => {
  it("freezes key, type, status, the IRS file date and the account's PRESENCE (never its id) at the given time, in a shape the service accepts", () => {
    const snap = buildCarrierSnapshot(eligible(), SNAP_AT)
    expect(snap).toEqual({
      org_key: "ground_up_liberation_project",
      org_type: "irs_501c3",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
      stripe_connect_account_present: true,
      snapshot_at: SNAP_AT.toISOString(),
    })
    expect(JSON.stringify(snap)).not.toContain("acct_")
    expect(assertCarrierSnapshot(snap)).toEqual(snap)
    // Round-trips through JSON (the column is JSONB).
    expect(assertCarrierSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap)
  })

  it("a coop snapshot carries a null file date and is accepted; an IRS-affirmed one without a date is not (L11)", () => {
    const coop = buildCarrierSnapshot(eligible({ org_type: "coop", verification_status: "unverified", verified_as_of: null }), SNAP_AT)
    expect(coop.verified_as_of).toBeNull()
    expect(assertCarrierSnapshot(coop)).toEqual(coop)

    const undated = buildCarrierSnapshot(eligible({ verified_as_of: null }), SNAP_AT)
    expect(() => assertCarrierSnapshot(undated)).toThrow(CarrierRefusalError)
    expect(() => assertCarrierSnapshot(undated)).toThrow(/verified_as_of/)
  })

  it("the service never trusts an unverified status in a snapshot, whatever the route did", () => {
    const base = buildCarrierSnapshot(eligible(), SNAP_AT)
    for (const verification_status of ["unverified", "pending", "not_found", "revoked"] as const) {
      const bad = { ...base, verification_status }
      let caught: unknown
      try {
        assertCarrierSnapshot(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(CarrierRefusalError)
      expect((caught as CarrierRefusalError).reason).toBe("invalid_carrier_snapshot")
      expect((caught as CarrierRefusalError).message).toContain(verification_status)
    }
    expect(() => assertCarrierSnapshot({ ...base, stripe_connect_account_present: false })).toThrow(/stripe_connect_account_present/)
    expect(() => assertCarrierSnapshot({ ...base, org_key: "" })).toThrow(/org_key/)
    expect(() => assertCarrierSnapshot({ ...base, org_type: "church" })).toThrow(/org_type/)
    expect(() => assertCarrierSnapshot({ ...base, snapshot_at: "yesterday" })).toThrow(/snapshot_at/)
    expect(() => assertCarrierSnapshot(null)).toThrow(/snapshot/)
    expect(() => assertCarrierSnapshot("ground_up_liberation_project")).toThrow(/snapshot/)
    // A boolean "is charity" is not a snapshot.
    expect(() => assertCarrierSnapshot({ org_key: "x", is_charity: true })).toThrow(CarrierRefusalError)
  })

  it("projectPoolCarrier shows what the pool was assigned under — key, status, file date — and null for an uncarried pool", () => {
    const snap = buildCarrierSnapshot(eligible(), SNAP_AT)
    expect(projectPoolCarrier({ carrier_org_key: snap.org_key, carrier_snapshot: snap })).toEqual({
      org_key: "ground_up_liberation_project",
      verification_status: "pub78_eligible",
      verified_as_of: AS_OF.toISOString(),
    })
    expect(projectPoolCarrier({ carrier_org_key: null, carrier_snapshot: null })).toBeNull()
    expect(projectPoolCarrier({})).toBeNull()
    // An unreadable snapshot never invents a status.
    expect(projectPoolCarrier({ carrier_org_key: "x", carrier_snapshot: { verification_status: "charity" } })).toEqual({
      org_key: "x",
      verification_status: "unverified",
      verified_as_of: null,
    })
  })
})
