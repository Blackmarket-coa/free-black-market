import { getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import { partnerLinks } from "../../partner-directory"
import { makeSubstrate, makeEstablishedNursery } from "./_fixtures"

/**
 * Q8 `compliance-tracker` after the certification vocabulary of 2026-09-07
 * (`docs/CDFI_COOP_ROADMAP.md` §3.6): every certificate is vendor-supplied
 * or outside FBM, so nothing is ever auto-satisfied; the checklist
 * requirement needs a verified document rather than merely a vault; and
 * the certifiers come from the partner directory.
 */

const q8 = getQuestDefinition("compliance-tracker")!

const withDoc = (verified: boolean) =>
  makeSubstrate({
    documents: {
      documents: [{ id: "d1", doc_type: "credential", label: "Cert", verified, expires_at: null }],
    },
  })

const status = (key: string, s = makeSubstrate()) =>
  evaluateQuest(q8, s).requirements.find((r) => r.key === key)!

describe("Q8 compliance-tracker — certification vocabulary", () => {
  it("takes its links from the directory's certifiers", () => {
    expect(q8.gatekeeper.links).toEqual(partnerLinks({ kind: "certifier" }))
    expect(q8.gatekeeper.links.length).toBeGreaterThan(0)
    for (const link of q8.gatekeeper.links) expect(link.url).toMatch(/^https:\/\//)
  })

  it("no longer auto-satisfies the document checklist", () => {
    expect(status("doc_checklist").status).toBe("unavailable")
    expect(status("doc_checklist", withDoc(false)).status).toBe("unsatisfied")
    expect(status("doc_checklist", withDoc(true)).status).toBe("satisfied")
  })

  it("keeps every certificate as a checklist item, never satisfied by FBM", () => {
    const ev = evaluateQuest(q8, makeEstablishedNursery())
    const byKey = Object.fromEntries(ev.requirements.map((r) => [r.key, r]))
    const vendorSupplied = [
      "sourcing",
      "organic_certificate",
      "naturally_grown_certificate",
      "device_certificate",
      "nursery_license",
      "nursery_inspection",
    ]
    const outside = ["inspection_forms", "gap_ghp_audit", "phytosanitary_certificate", "seed_labelling"]
    for (const key of vendorSupplied) expect(byKey[key]).toMatchObject({ tag: "vendor-supplied", status: "checklist" })
    for (const key of outside) expect(byKey[key]).toMatchObject({ tag: "outside-fbm", status: "checklist" })
    // Conditional items say so in their label, so a vendor who does not do
    // the thing can see it does not apply.
    for (const key of ["organic_certificate", "device_certificate", "nursery_license", "phytosanitary_certificate", "seed_labelling"]) {
      expect(byKey[key].label).toMatch(/\(if /)
    }
  })

  it("leaves the stage gates and the guardrail as they were", () => {
    expect(q8.stageGates.map((g) => g.key)).toEqual(["started", "documented", "cert_ready"])
    expect(q8.healthClaimsGuardrail).toBe(true)
    // One verified license still opens every gate, as before the vocabulary.
    const licensed = makeSubstrate({
      documents: {
        documents: [{ id: "d1", doc_type: "license", label: "Licence", verified: true, expires_at: null }],
      },
    })
    expect(evaluateQuest(q8, licensed).stages.every((s) => s.open)).toBe(true)
  })
})
