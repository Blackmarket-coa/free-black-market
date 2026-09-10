import { getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import { partnerLinks } from "../../partner-directory"
import { makeSubstrate } from "./_fixtures"
import type { VendorSubstrate } from "../types"

/**
 * Q15 `deconstruction-readiness` (`docs/TRANSMUTATION_STRATEGY.md` §4.4).
 *
 * The lines this quest must not blur: FBM refers rather than underwrites, it
 * ships no regulatory table, and abatement is not the same credential as
 * renovation under the RRP rule.
 */

const q15 = getQuestDefinition("deconstruction-readiness")!

const requirement = (key: string) => q15.requirements.find((r) => r.key === key)!

const docs = (
  ...entries: Array<{ doc_type: string; verified?: boolean }>
): Partial<VendorSubstrate> => ({
  documents: {
    documents: entries.map((entry, index) => ({
      id: `d${index}`,
      doc_type: entry.doc_type,
      label: entry.doc_type,
      verified: entry.verified ?? true,
      expires_at: null,
    })),
  },
})

const stage = (key: string, s: VendorSubstrate) =>
  evaluateQuest(q15, s).stages.find((g) => g.key === key)!

describe("Q15 deconstruction-readiness — posture", () => {
  it("takes its links from the directory's salvage kinds", () => {
    expect(q15.gatekeeper.links).toEqual(
      partnerLinks({ kind: ["abatement", "deconstruction", "reuse_center", "test_lab"] })
    )
    expect(q15.gatekeeper.links.length).toBeGreaterThan(0)
    for (const link of q15.gatekeeper.links) {
      expect(link.url).toMatch(/^https:\/\//)
      expect(Object.keys(link).sort()).toEqual(["label", "url"])
    }
  })

  it("leaves abatement outside FBM entirely", () => {
    // A paid referral to an abatement contractor is FBM taking a cut of a
    // hazmat job. The quest must not evaluate, verify or satisfy this.
    const abatement = requirement("abatement_subcontractor")
    expect(abatement.tag).toBe("outside-fbm")
    expect(abatement).not.toHaveProperty("satisfied")
    expect(abatement.note).toMatch(/state/i)
  })

  it("keeps abatement and RRP as separate requirements", () => {
    // Salvage in pre-1978 housing is usually renovation under the RRP rule
    // rather than abatement, and the two carry different certifications.
    // Conflating them sends someone after the wrong credential.
    const rrp = requirement("rrp_certification")
    expect(rrp.note).toMatch(/1978/)
    expect(rrp.note).toMatch(/separate/i)
    expect(rrp.key).not.toBe("abatement_subcontractor")
  })

  it("claims no verification it does not perform", () => {
    // "Verified" means an FBM reviewer confirmed the document is what it says
    // it is — not that the state's register was checked.
    expect(requirement("contractor_license").note).toMatch(
      /does not check it against your state's register/i
    )
  })
})

describe("Q15 deconstruction-readiness — evaluation", () => {
  it("opens no stage for a vendor with nothing on file", () => {
    const s = makeSubstrate()
    expect(stage("insured", s).open).toBe(false)
    expect(stage("licensed", s).open).toBe(false)
    expect(stage("site_ready", s).open).toBe(false)
  })

  it("opens Insured on a verified liability certificate alone", () => {
    const s = makeSubstrate(docs({ doc_type: "insurance" }))
    expect(stage("insured", s).open).toBe(true)
    expect(stage("licensed", s).open).toBe(false)
  })

  it("does not count an unverified document", () => {
    const s = makeSubstrate(docs({ doc_type: "insurance", verified: false }))
    expect(stage("insured", s).open).toBe(false)
    expect(stage("insured", s).missing).toContain(
      "A verified general liability certificate in your vault"
    )
  })

  it("opens Licensed on insurance, licence and three months", () => {
    const s = makeSubstrate({
      ...docs({ doc_type: "insurance" }, { doc_type: "license" }),
      operating: {
        account_created_at: "2026-01-01T00:00:00.000Z",
        account_age_days: 120,
        months_active: 4,
        listing_count: 0,
        orders_fulfilled: 0,
        fulfillment_reliability: null,
      },
    })
    expect(stage("licensed", s).open).toBe(true)
    expect(stage("site_ready", s).open).toBe(false)
  })

  it("holds Site-Ready back until there is somewhere for the material to go", () => {
    // Deconstruction only pays if what comes out has an outlet.
    const base = {
      ...docs(
        { doc_type: "insurance" },
        { doc_type: "license" },
        { doc_type: "credential" }
      ),
      operating: {
        account_created_at: "2026-01-01T00:00:00.000Z",
        account_age_days: 220,
        months_active: 7,
        listing_count: 0,
        orders_fulfilled: 0,
        fulfillment_reliability: null,
      },
    }
    const without = makeSubstrate(base)
    expect(stage("site_ready", without).open).toBe(false)
    expect(stage("site_ready", without).missing).toContain(
      "At least one listing, so recovered material has an outlet"
    )

    const with_ = makeSubstrate({
      ...base,
      operating: { ...base.operating, listing_count: 1 },
    })
    expect(stage("site_ready", with_).open).toBe(true)
  })

  it("names the hazard-training credential when it is what is missing", () => {
    const s = makeSubstrate({
      ...docs({ doc_type: "insurance" }, { doc_type: "license" }),
      operating: {
        account_created_at: "2026-01-01T00:00:00.000Z",
        account_age_days: 220,
        months_active: 7,
        listing_count: 3,
        orders_fulfilled: 0,
        fulfillment_reliability: null,
      },
    })
    expect(stage("site_ready", s).missing).toEqual([
      "A verified RRP or hazard-training credential",
    ])
  })
})
