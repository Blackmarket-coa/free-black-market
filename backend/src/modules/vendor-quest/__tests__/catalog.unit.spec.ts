/**
 * Whole-catalog test: every quest definition (Q1–Q13) runs through the SAME
 * generic engine with no per-quest code. This is the guarantee that adding a
 * quest is pure config.
 */
import { listQuestDefinitions, getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import { buildPacketExport } from "../packet"
import { aggregateSubstrates } from "../substrate/aggregate"
import { makeSubstrate } from "./_fixtures"
import type { VendorSubstrate } from "../types"

/** A vendor that maxes out every universal + domain signal, so final gates open. */
function makeMaxedSubstrate(): VendorSubstrate {
  return makeSubstrate({
    revenue: {
      currency: "usd",
      lifetime_revenue: 100_000,
      last_30d_revenue: 10_000,
      avg_daily_revenue: 300,
      monthly: Array.from({ length: 12 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}`,
        revenue: 8000,
      })),
      source: "hawala-ledger:CREDIT+PURCHASE",
    },
    operating: {
      account_created_at: "2024-01-01T00:00:00.000Z",
      account_age_days: 900,
      months_active: 30,
      listing_count: 40,
      orders_fulfilled: 500,
      fulfillment_reliability: 0.99,
    },
    customers: {
      distinct_customers: 200,
      repeat_customers: 80,
      repeat_rate: 0.4,
      wholesale_relationships: 5,
    },
    reputation: {
      trust_score: 95,
      tier: "Verified",
      total_xp: 1200,
      dispute_count: 0,
      verified_credentials: 3,
    },
    inventory: { on_hand_units: 1000, retail_value: 12000, cost_value: 4000 },
    production: { batch_count: 30, total_started: 2000, total_yield: 1800, methods: ["cutting", "seed"] },
    channels: { channels: [{ key: "apothecary", label: "Apothecary" }] },
    documents: {
      documents: [
        { id: "d1", doc_type: "license", label: "Business license", verified: true, expires_at: null },
        { id: "d2", doc_type: "credential", label: "Cert", verified: true, expires_at: null },
      ],
    },
  })
}

describe("full quest catalog", () => {
  it("has all 13 quests across the four categories", () => {
    const defs = listQuestDefinitions()
    expect(defs).toHaveLength(13)
    const categories = new Set(defs.map((d) => d.category))
    expect(categories).toEqual(
      new Set([
        "Capital & Funding",
        "Market Access & Growth",
        "Certification & Trust",
        "Cooperative & Mission",
      ])
    )
    // keys are unique
    expect(new Set(defs.map((d) => d.key)).size).toBe(13)
  })

  it("every quest evaluates through the engine without throwing", () => {
    const maxed = makeMaxedSubstrate()
    // Collective quests need an aggregate with member_count; build one from 3.
    const aggregate = aggregateSubstrates([maxed, makeMaxedSubstrate(), makeMaxedSubstrate()], ["a", "b", "c"])

    for (const def of listQuestDefinitions()) {
      const substrate = def.type === "collective" ? aggregate : maxed
      const ev = evaluateQuest(def, substrate)

      // Well-formed output.
      expect(ev.quest_key).toBe(def.key)
      expect(ev.stages).toHaveLength(def.stageGates.length)
      // Stages are ordered.
      const orders = ev.stages.map((s) => s.order)
      expect([...orders].sort((a, b) => a - b)).toEqual(orders)
      // Requirement statuses are from the known set.
      for (const r of ev.requirements) {
        expect(["satisfied", "unsatisfied", "unavailable", "checklist"]).toContain(r.status)
      }
    }
  })

  it("also degrades gracefully for a universal-only vendor (no throw, no domain crash)", () => {
    const universalOnly = makeSubstrate({
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 100 },
      operating: { ...makeSubstrate().operating, months_active: 2 },
    })
    for (const def of listQuestDefinitions()) {
      expect(() => evaluateQuest(def, universalOnly)).not.toThrow()
    }
  })

  it("collective quests declare consent scopes; individual quests do not require them", () => {
    for (const def of listQuestDefinitions()) {
      if (def.type === "collective") {
        expect(Array.isArray(def.requiredConsentScopes)).toBe(true)
        expect(def.requiredConsentScopes!.length).toBeGreaterThan(0)
      }
    }
  })

  it("builds a packet for every quest that defines one (maxed vendor opens final gate)", () => {
    const maxed = makeMaxedSubstrate()
    const aggregate = aggregateSubstrates([maxed, makeMaxedSubstrate(), makeMaxedSubstrate()], ["a", "b", "c"])
    for (const def of listQuestDefinitions()) {
      const substrate = def.type === "collective" ? aggregate : maxed
      if (def.packetTemplate) {
        const packet = buildPacketExport(def, substrate)!
        expect(packet.disclaimer.length).toBeGreaterThan(0)
        expect(Array.isArray(packet.remaining_items)).toBe(true)
        expect(packet.sections.length).toBeGreaterThan(0)
      } else {
        expect(buildPacketExport(def, substrate)).toBeNull()
      }
    }
  })

  it("wellness product/practitioner quests carry the health-claims guardrail", () => {
    expect(getQuestDefinition("compliance-tracker")!.healthClaimsGuardrail).toBe(true)
    expect(getQuestDefinition("wellness-insurance")!.healthClaimsGuardrail).toBe(true)
    expect(getQuestDefinition("trust-tier")!.healthClaimsGuardrail).toBe(true)
  })
})
