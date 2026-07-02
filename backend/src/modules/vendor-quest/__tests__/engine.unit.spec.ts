/**
 * Generic quest-engine tests.
 *
 * These prove the engine is definition-driven and NOT FSA- or physical-goods-
 * shaped: the FSA loan quest and a wellness-practitioner quest run through the
 * exact same `evaluateQuest`, and a universal-only vendor (no inventory, no
 * production) is fully supported.
 */
import * as fs from "fs"
import * as path from "path"
import { evaluateQuest } from "../engine"
import { getQuestDefinition } from "../definitions"
import { makeSubstrate, makeEstablishedNursery } from "./_fixtures"

describe("evaluateQuest — generic stage gates", () => {
  const fsa = getQuestDefinition("fsa-farm-loan")!

  it("opens leading gates contiguously and reports what's missing", () => {
    const brandNew = makeSubstrate() // 0 revenue, 0 months
    const evalNew = evaluateQuest(fsa, brandNew)
    expect(evalNew.current_stage_index).toBe(0)
    expect(evalNew.current_stage_key).toBeNull()
    expect(evalNew.packet_available).toBe(false)
    expect(evalNew.stages[0].missing.length).toBeGreaterThan(0)
  })

  it("advances stage as substrate grows", () => {
    const established = makeEstablishedNursery()
    const evalEst = evaluateQuest(fsa, established)
    // 18 months, $25k, 12 months cash-flow → all three gates open.
    expect(evalEst.current_stage_index).toBe(3)
    expect(evalEst.final_gate_open).toBe(true)
    expect(evalEst.packet_available).toBe(true)
  })

  it("tags requirements by data source and marks absent domain fields unavailable", () => {
    const serviceVendor = makeSubstrate({
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 500 },
      operating: { ...makeSubstrate().operating, months_active: 8 },
    })
    const ev = evaluateQuest(fsa, serviceVendor)
    const byKey = Object.fromEntries(ev.requirements.map((r) => [r.key, r]))
    // Domain requirements are "unavailable" (not failed) with no inventory/production.
    expect(byKey["asset_valuation"].status).toBe("unavailable")
    expect(byKey["production_yield"].status).toBe("unavailable")
    // Outside-FBM items are always checklist — never auto-satisfied/fabricated.
    expect(byKey["id_credit_legal_forms"].status).toBe("checklist")
    // Platform income requirement is satisfied.
    expect(byKey["income_verification"].status).toBe("satisfied")
  })
})

describe("wellness practitioner quest runs through the SAME engine", () => {
  it("evaluates with inventory/production absent, no branching, no crash", () => {
    const insurance = getQuestDefinition("wellness-insurance")!
    // Universal-only vendor: no inventory, no production, no channels.
    const practitioner = makeSubstrate({
      revenue: {
        ...makeSubstrate().revenue,
        lifetime_revenue: 4_000,
        monthly: [
          { month: "2026-01", revenue: 1000 },
          { month: "2026-02", revenue: 1500 },
          { month: "2026-03", revenue: 1500 },
        ],
      },
      operating: { ...makeSubstrate().operating, months_active: 7, account_age_days: 210 },
    })
    expect(practitioner.inventory).toBeNull()
    expect(practitioner.production).toBeNull()

    const ev = evaluateQuest(insurance, practitioner)
    expect(ev.current_stage_index).toBe(2) // Operating + Quote-Ready
    expect(ev.packet_available).toBe(true)
  })

  it("trust-tier quest (no packet) never yields a packet", () => {
    const trust = getQuestDefinition("trust-tier")!
    const s = makeSubstrate({
      operating: { ...makeSubstrate().operating, months_active: 12 },
      reputation: { ...makeSubstrate().reputation, trust_score: 80, dispute_count: 0 },
    })
    const ev = evaluateQuest(trust, s)
    expect(ev.current_stage_index).toBe(2)
    expect(ev.packet_available).toBe(false) // internal unlock, no packetTemplate
  })
})

describe("engine has no quest-specific or physical-goods branching", () => {
  it("engine.ts code references no quest key or vertical literal", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "engine.ts"), "utf8")
    // Strip comments — the guarantee is about CODE, not the explanatory prose
    // (which is allowed to mention FSA/wellness when describing the design).
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
    // No quest key is hardcoded, and no domain field is branched on by name —
    // the engine handles them generically via DomainFieldKey.
    expect(code).not.toMatch(/fsa-farm-loan|wellness-insurance|trust-tier/i)
    expect(code).not.toMatch(/["'](inventory|production|nursery)["']/i)
  })
})
