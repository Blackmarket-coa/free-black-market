/**
 * Decoupling guarantees (hard constraints):
 *   - dropping a quest never deletes the vendor's substrate records
 *   - enabling one module/quest never forces another (independent flags)
 *   - a universal-only vendor (no inventory, no production) is fully supported
 *   - the nursery profit-per-sqft view works with no quest enrolled
 */
import VendorQuestModuleService from "../service"
import { evaluateQuest } from "../engine"
import { getQuestDefinition } from "../definitions"
import { makeSubstrate } from "./_fixtures"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../../shared/feature-flags"
import { profitPerSqFt } from "../../nursery-vertical/analytics/profit-per-sqft"

describe("dropping a quest preserves substrate records", () => {
  it("only flips enrollment status; calls no delete on any module", async () => {
    const svc: any = Object.create(VendorQuestModuleService.prototype)
    const store = new Map<string, any>([
      ["enr_1", { id: "enr_1", seller_id: "sel_1", quest_key: "fsa-farm-loan", status: "ACTIVE" }],
    ])
    svc.updateQuestEnrollments = jest.fn(async (p: any) => {
      store.set(p.id, { ...store.get(p.id), ...p })
      return [p]
    })
    svc.retrieveQuestEnrollment = jest.fn(async (id: string) => store.get(id))
    // Any delete method that might exist must NOT be invoked by drop().
    svc.deleteQuestEnrollments = jest.fn()

    const dropped = await svc.drop("enr_1")

    expect(dropped.status).toBe("DROPPED")
    expect(dropped.dropped_at).toBeInstanceOf(Date)
    expect(svc.deleteQuestEnrollments).not.toHaveBeenCalled()
    // The enrollment row itself still exists (soft state change, not deletion).
    expect(store.get("enr_1")).toBeDefined()
    // drop() is scoped to the enrollment — it never touches production/vault/etc.
    expect(svc.updateQuestEnrollments).toHaveBeenCalledTimes(1)
  })
})

describe("modules/quests are independently enabled by their own flags", () => {
  const saved: Record<string, string | undefined> = {}
  const keys = [
    "VENDOR_QUESTS_V1",
    "PRODUCTION_LEDGER_V1",
    "DOCUMENT_VAULT_V1",
    "NURSERY_VERTICAL_V1",
  ] as const

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[PHASE0_FEATURE_FLAGS[k]]
      delete process.env[PHASE0_FEATURE_FLAGS[k]]
    }
  })
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[PHASE0_FEATURE_FLAGS[k]]
      else process.env[PHASE0_FEATURE_FLAGS[k]] = saved[k]
    }
  })

  it("enabling quests does not enable production ledger / vault / nursery", () => {
    process.env[PHASE0_FEATURE_FLAGS.VENDOR_QUESTS_V1] = "true"
    expect(featureFlagState.isEnabled("VENDOR_QUESTS_V1")).toBe(true)
    expect(featureFlagState.isEnabled("PRODUCTION_LEDGER_V1")).toBe(false)
    expect(featureFlagState.isEnabled("DOCUMENT_VAULT_V1")).toBe(false)
    expect(featureFlagState.isEnabled("NURSERY_VERTICAL_V1")).toBe(false)
  })
})

describe("universal-only vendor is first-class", () => {
  it("evaluates a quest with all domain fields null and never throws", () => {
    const universalOnly = makeSubstrate({
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 2_000 },
      operating: { ...makeSubstrate().operating, months_active: 13 },
    })
    expect(universalOnly.inventory).toBeNull()
    expect(universalOnly.production).toBeNull()
    expect(universalOnly.channels).toBeNull()
    expect(universalOnly.documents).toBeNull()

    const fsa = getQuestDefinition("fsa-farm-loan")!
    expect(() => evaluateQuest(fsa, universalOnly)).not.toThrow()
  })
})

describe("nursery profit-per-sqft works with no quest enrolled", () => {
  it("is a pure calculator independent of the quest engine", () => {
    // No enrollment, no substrate — just the decision-support math.
    const r = profitPerSqFt({
      sellPrice: 12,
      costToProduce: 4,
      footprintSqFtPerUnit: 0.25,
      weeksToSell: 26,
    })
    expect(r.profitPerUnit).toBe(8)
    expect(r.annualProfitPerSqFt).toBeGreaterThan(0)
  })
})
