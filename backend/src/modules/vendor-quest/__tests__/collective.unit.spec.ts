/**
 * Collective quests: aggregation math + the consent guarantees.
 *
 *   - a collective quest runs through the SAME engine on an aggregate substrate
 *   - aggregation includes ONLY members who consent to every required scope
 *   - a revoked consent excludes that member
 *   - a non-member's records are never aggregated (consent, not membership,
 *     gates inclusion)
 */
import VendorQuestModuleService from "../service"
import { aggregateSubstrates } from "../substrate/aggregate"
import { evaluateQuest } from "../engine"
import { getQuestDefinition } from "../definitions"
import { makeSubstrate } from "./_fixtures"

describe("aggregateSubstrates", () => {
  it("sums universal figures and unions domain fields", () => {
    const a = makeSubstrate({
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 1000, monthly: [{ month: "2026-01", revenue: 1000 }] },
      operating: { ...makeSubstrate().operating, months_active: 10, listing_count: 5, orders_fulfilled: 20 },
    })
    const b = makeSubstrate({
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 500, monthly: [{ month: "2026-01", revenue: 500 }] },
      operating: { ...makeSubstrate().operating, months_active: 4, listing_count: 3, orders_fulfilled: 8 },
      documents: { documents: [{ id: "d1", doc_type: "lease", label: "Lease", verified: true, expires_at: null }] },
    })

    const agg = aggregateSubstrates([a, b], ["sel_a", "sel_b"])
    expect(agg.revenue.lifetime_revenue).toBe(1500)
    expect(agg.revenue.monthly).toEqual([{ month: "2026-01", revenue: 1500 }])
    expect(agg.operating.months_active).toBe(10) // strongest tenure
    expect(agg.operating.listing_count).toBe(8) // summed
    expect(agg.collective?.member_count).toBe(2)
    expect(agg.documents?.documents).toHaveLength(1) // unioned
  })
})

describe("collective quest through the same engine", () => {
  it("evaluates Co-op Formation on an aggregate substrate", () => {
    const coop = getQuestDefinition("coop-formation")!
    expect(coop.type).toBe("collective")

    const members = [
      makeSubstrate({
        revenue: { ...makeSubstrate().revenue, lifetime_revenue: 12000 },
        operating: { ...makeSubstrate().operating, months_active: 14 },
      }),
      makeSubstrate({
        revenue: { ...makeSubstrate().revenue, lifetime_revenue: 9000 },
        operating: { ...makeSubstrate().operating, months_active: 13 },
      }),
      makeSubstrate({
        revenue: { ...makeSubstrate().revenue, lifetime_revenue: 3000 },
        operating: { ...makeSubstrate().operating, months_active: 12 },
      }),
    ]
    const agg = aggregateSubstrates(members, ["a", "b", "c"])
    const ev = evaluateQuest(coop, agg)
    // 3 members, $24k combined, 14 months → all three gates open.
    expect(ev.current_stage_index).toBe(3)
    expect(ev.packet_available).toBe(true)
  })

  it("a single member cannot open the co-op gates", () => {
    const coop = getQuestDefinition("coop-formation")!
    const agg = aggregateSubstrates(
      [makeSubstrate({ revenue: { ...makeSubstrate().revenue, lifetime_revenue: 50000 } })],
      ["solo"]
    )
    const ev = evaluateQuest(coop, agg)
    // member_count 1 < 2 → Forming gate stays closed.
    expect(ev.current_stage_index).toBe(0)
    expect(ev.stages[0].missing).toContain("At least 2 consenting members")
  })
})

describe("consent gates aggregation (never leak)", () => {
  function makeService(consents: any[], members: any[]) {
    const svc: any = Object.create(VendorQuestModuleService.prototype)
    svc.listQuestMemberConsents = jest.fn(async (filter: any = {}) =>
      consents.filter((c) =>
        Object.entries(filter).every(([k, v]) => c[k] === v)
      )
    )
    svc.listQuestEnrollments = jest.fn(async () => members)
    return svc
  }

  it("includes only members consenting to EVERY required scope", async () => {
    const svc = makeService(
      [
        { id: "c1", collective_id: "col", seller_id: "full", consent_scopes: ["revenue", "operating"], revoked_at: null },
        { id: "c2", collective_id: "col", seller_id: "partial", consent_scopes: ["revenue"], revoked_at: null },
      ],
      []
    )
    const ids = await svc.getConsentedMemberIds("col", ["revenue", "operating"])
    expect(ids).toEqual(["full"]) // "partial" excluded — didn't consent to operating
  })

  it("excludes a member who revoked consent", async () => {
    const svc = makeService(
      [
        { id: "c1", collective_id: "col", seller_id: "stay", consent_scopes: ["revenue"], revoked_at: null },
        { id: "c2", collective_id: "col", seller_id: "gone", consent_scopes: ["revenue"], revoked_at: new Date() },
      ],
      []
    )
    const ids = await svc.getConsentedMemberIds("col", ["revenue"])
    expect(ids).toEqual(["stay"])
  })

  it("returns no members when none have consented (nothing to aggregate)", async () => {
    const svc = makeService([], [])
    const ids = await svc.getConsentedMemberIds("col", ["revenue"])
    expect(ids).toEqual([])
  })
})
