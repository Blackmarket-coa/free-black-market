import { getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import { buildPacketExport } from "../packet"
import { makeSubstrate, makeEstablishedNursery } from "./_fixtures"
import { partnerLinks } from "../../partner-directory"

/**
 * Q3 `microlender-readiness` after the CDFI extension of 2026-09-06
 * (`docs/CDFI_COOP_ROADMAP.md` §3.1): the document items a CDFI underwriter
 * asks for are checklisted, never fabricated; the business plan is
 * `assisted` with a real predicate, so it cannot read as done before a
 * verified plan exists; and the vendor is pointed at generic CDFI entry
 * points, not one crowdfunder.
 */

const q3 = getQuestDefinition("microlender-readiness")!
const q1 = getQuestDefinition("fsa-farm-loan")!

const requirement = (key: string, s = makeSubstrate()) =>
  evaluateQuest(q3, s).requirements.find((r) => r.key === key)!

const withPlan = (verified: boolean) =>
  makeSubstrate({
    documents: {
      documents: [
        { id: "d1", doc_type: "business_plan", label: "Plan", verified, expires_at: null },
      ],
    },
  })

describe("Q3 microlender-readiness — CDFI requirements", () => {
  it("takes its links from the partner directory: CDFI locators, microlenders, crowdfunders", () => {
    expect(q3.gatekeeper.links).toEqual(
      partnerLinks({ kind: ["cdfi", "microlender", "crowdfunder"] })
    )
    const labels = q3.gatekeeper.links.map((l) => l.label)
    expect(labels).toContain("CDFI Fund — list of certified CDFIs")
    expect(labels).toContain("Opportunity Finance Network — CDFI locator")
    expect(labels).toContain("Kiva U.S.")
    for (const link of q3.gatekeeper.links) expect(link.url).toMatch(/^https:\/\//)
  })

  it("never auto-satisfies the business plan", () => {
    // No vault at all: the requirement is unavailable, not satisfied.
    expect(requirement("business_plan").status).toBe("unavailable")
    // A plan that nobody has verified is not evidence yet.
    expect(requirement("business_plan", withPlan(false)).status).toBe("unsatisfied")
    // A verified plan is.
    expect(requirement("business_plan", withPlan(true)).status).toBe("satisfied")
  })

  it("keeps the documents FBM cannot produce as checklist items", () => {
    const ev = evaluateQuest(q3, makeEstablishedNursery())
    const byKey = Object.fromEntries(ev.requirements.map((r) => [r.key, r]))
    expect(byKey.use_of_funds).toMatchObject({ tag: "vendor-supplied", status: "checklist" })
    expect(byKey.entity_documents).toMatchObject({ tag: "vendor-supplied", status: "checklist" })
    expect(byKey.personal_financials_tax_returns).toMatchObject({ tag: "outside-fbm", status: "checklist" })
    expect(byKey.collateral_or_cosigner).toMatchObject({ tag: "outside-fbm", status: "checklist" })
  })

  it("leaves the stage gates as they were", () => {
    expect(q3.stageGates.map((g) => g.key)).toEqual(["operating", "documented", "lender_ready"])
    const ev = evaluateQuest(q3, makeEstablishedNursery())
    expect(ev.stages.every((s) => s.open)).toBe(true)
  })

  it("packet shows the vault's verified state and lists what is still outside FBM", () => {
    const packet = buildPacketExport(q3, withPlan(false))!
    const documents = packet.sections.find((s) => s.key === "documents")!
    expect(documents.available).toBe(true)
    expect(documents.data).toEqual([
      { id: "d1", doc_type: "business_plan", label: "Plan", verified: false, expires_at: null },
    ])
    expect(packet.remaining_items).toEqual([
      "Business plan (upload to vault for FBM review)",
      "Use-of-funds statement",
      "Entity documents (formation, EIN, licenses)",
      "Personal financial statement and tax returns",
      "Collateral schedule or co-signer, as the lender requires",
      "Character / community references",
      "Completed lender application",
    ])

    // Once the plan is verified it drops off the list; the rest never do.
    const verified = buildPacketExport(q3, withPlan(true))!
    expect(verified.remaining_items[0]).toBe("Use-of-funds statement")

    // A vendor with no vault gets the section flagged, not fabricated.
    const noVault = buildPacketExport(q3, makeSubstrate())!
    expect(noVault.sections.find((s) => s.key === "documents")).toMatchObject({
      available: false,
      data: [],
      note: "No documents uploaded.",
    })
  })
})

describe("Q1 fsa-farm-loan — business plan predicate", () => {
  it("no longer reads as satisfied before a verified plan exists", () => {
    const status = (s = makeSubstrate()) =>
      evaluateQuest(q1, s).requirements.find((r) => r.key === "business_plan")!.status
    expect(status()).toBe("unavailable")
    expect(status(withPlan(false))).toBe("unsatisfied")
    expect(status(withPlan(true))).toBe("satisfied")
  })
})
