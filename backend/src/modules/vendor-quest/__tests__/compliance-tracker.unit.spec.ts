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

/**
 * Tier B item 11 gave the organic and weights-and-measures certificates their
 * own vault types. The `cert_ready` gate accepted only `license` and
 * `credential`, which is where those documents used to land — so widening it
 * is not a nicety. Narrowing it, or swapping the old types for the new ones,
 * would close a gate vendors have already passed.
 */
describe("Q8 cert_ready gate — widened, never narrowed", () => {
  const certGate = (docType: string, verified = true) =>
    evaluateQuest(
      q8,
      makeSubstrate({
        documents: {
          documents: [
            { id: "d1", doc_type: docType, label: "Cert", verified, expires_at: null },
          ],
        },
      })
    ).stages.find((g) => g.key === "cert_ready")!.open

  it("still opens on the types certificates used to be filed under", () => {
    expect(certGate("license")).toBe(true)
    expect(certGate("credential")).toBe(true)
  })

  it("also opens on the new dedicated certificate types", () => {
    expect(certGate("organic_certification")).toBe(true)
    expect(certGate("device_certificate")).toBe(true)
  })

  it("still needs the document to be verified, and ignores unrelated types", () => {
    expect(certGate("organic_certification", false)).toBe(false)
    expect(certGate("lease")).toBe(false)
  })

  it("keeps the certificate requirements vendor-supplied — a type is not a validation", () => {
    for (const key of ["organic_certificate", "device_certificate"]) {
      const req = q8.requirements.find((r) => r.key === key)!
      expect({ key, tag: req.tag, hasPredicate: req.satisfied != null }).toEqual({
        key,
        tag: "vendor-supplied",
        hasPredicate: false,
      })
    }
  })
})

/**
 * The `permits` substrate field (`docs/CDFI_COOP_ROADMAP.md` §3.6, "read the
 * permit store that exists"). `cottage-food` has computed permit and
 * food-handler expiry as self-declared facts since it shipped and Q8 read none
 * of it.
 *
 * Two constraints govern these requirements, and both come from `cottage-food`
 * itself. It "never blocks a sale" and "the seller is the authority on their
 * own compliance" — so these say only that a date was recorded and has not
 * passed, they are labelled as self-declared, and they gate nothing.
 */
describe("Q8 permit requirements — self-declared, and gating nothing", () => {
  const permitStanding = (status: string, days: number | null = 100) => ({
    status: status as "unset" | "ok" | "expiring_soon" | "expired",
    expires_at: days === null ? null : "2027-01-01T00:00:00.000Z",
    days_until: days,
  })

  const withPermits = (permit: string, foodHandler = "ok") =>
    makeSubstrate({
      permits: {
        operation_type: "cottage_food",
        permit: permitStanding(permit, permit === "unset" ? null : 100),
        food_handler: permitStanding(foodHandler, foodHandler === "unset" ? null : 100),
        advisory_count: 0,
      },
    })

  it("reads unavailable for a vendor with no cottage-food profile", () => {
    // Not "unsatisfied" — a jeweller has no food permit to be missing, and the
    // engine derives this purely from the field being null.
    expect(status("permit_current").status).toBe("unavailable")
    expect(status("food_handler_current").status).toBe("unavailable")
  })

  it("is satisfied by a recorded, in-date permit", () => {
    expect(status("permit_current", withPermits("ok")).status).toBe("satisfied")
    expect(status("permit_current", withPermits("expiring_soon")).status).toBe("satisfied")
  })

  it("is unsatisfied once the declared date has passed", () => {
    expect(status("permit_current", withPermits("expired")).status).not.toBe("satisfied")
  })

  it("is unsatisfied when no date was declared at all", () => {
    // The defect this avoids: an `assisted` requirement with no predicate reads
    // as satisfied unconditionally, so "unset" must be an explicit failure.
    expect(status("permit_current", withPermits("unset")).status).not.toBe("satisfied")
  })

  it("tracks the two credentials separately", () => {
    const s = withPermits("ok", "expired")
    expect(status("permit_current", s).status).toBe("satisfied")
    expect(status("food_handler_current", s).status).not.toBe("satisfied")
  })

  it("says in its own label that the date is the vendor's own", () => {
    // The honest-UI constraint, asserted rather than trusted to review: FBM
    // ships no state-law table and must not read as certifying compliance.
    for (const key of ["permit_current", "food_handler_current"]) {
      const req = q8.requirements.find((r) => r.key === key)!
      expect(req.label).toMatch(/as you declared it/i)
      expect(req.tag).toBe("assisted")
      expect(req.needs).toEqual(["permits"])
    }
    const permitReq = q8.requirements.find((r) => r.key === "permit_current")!
    expect(permitReq.note).toMatch(/makes no legal determination/i)
  })

  it("moves no stage gate, in either direction", () => {
    // The #836 lesson: a new requirement must not close a gate a vendor has
    // already passed. Compare every gate with and without a permit profile.
    const bare = makeSubstrate()
    const withProfile = withPermits("ok")
    const gatesOf = (s: ReturnType<typeof makeSubstrate>) =>
      evaluateQuest(q8, s).stages.map((g) => [g.key, g.open])

    expect(gatesOf(withProfile)).toEqual(gatesOf(bare))
    expect(gatesOf(withPermits("expired"))).toEqual(gatesOf(bare))
  })
})
