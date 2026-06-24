/**
 * XP demurrage unit tests.
 *
 * The load-bearing invariant: demurrage reduces the **spendable** balance only
 * and NEVER touches lifetime `total_xp`, role XP, levels, or titles. The decay
 * math, grace floor, and floor-at-0 are exercised on a prototype service with
 * stubbed persistence.
 */
import ProgressionModuleService from "../../modules/progression/service"
import { Stance } from "../../modules/progression/stance"
import { runXpDemurrage } from "../xp-demurrage"

function makeService(sheets: Array<Record<string, unknown>>) {
  const svc: any = Object.create(ProgressionModuleService.prototype)
  const store = new Map(sheets.map((s) => [s.id, { ...s }]))
  svc.updates = [] as Array<Record<string, unknown>>
  svc.events = [] as Array<Record<string, unknown>>

  svc.listCharacterSheets = jest.fn(async (filter: any) => {
    const min = filter?.spendable_xp?.$gt ?? -Infinity
    return [...store.values()].filter((s: any) => Number(s.spendable_xp) > min)
  })
  svc.getOrCreateCharacterSheet = jest.fn(async (cid: string) =>
    [...store.values()].find((s: any) => s.customer_id === cid)
  )
  svc.createXpEvents = jest.fn(async (e: any) => {
    svc.events.push(e)
    return [e]
  })
  svc.updateCharacterSheets = jest.fn(async (patch: any) => {
    svc.updates.push(patch)
    const cur: any = store.get(patch.id)
    store.set(patch.id, { ...cur, ...patch })
    return [patch]
  })
  return svc as ProgressionModuleService & Record<string, any>
}

const sheet = (over: Record<string, unknown>) => ({
  id: "sheet_1",
  customer_id: "cus_1",
  active_stance: Stance.CONSUMER,
  spendable_xp: 1000,
  total_xp: 5000,
  consumer_xp: 5000,
  consumer_level: 7,
  ...over,
})

describe("xp demurrage", () => {
  it("decays only the balance above the grace floor", async () => {
    const svc = makeService([sheet({ spendable_xp: 1000 })])
    const results = await svc.applyDemurrage({ rate: 0.1, minBalance: 100 })
    // (1000 - 100) * 0.1 = 90
    expect(results).toEqual([{ customer_id: "cus_1", decayed: 90 }])
    const update = svc.updates.find((u: any) => "spendable_xp" in u)
    expect(update.spendable_xp).toBe(910)
  })

  it("never reduces total_xp, role XP, levels, or titles", async () => {
    const svc = makeService([sheet({ spendable_xp: 1000 })])
    await svc.applyDemurrage({ rate: 0.1, minBalance: 100 })
    for (const u of svc.updates) {
      expect(u).not.toHaveProperty("total_xp")
      expect(u).not.toHaveProperty("consumer_xp")
      expect(u).not.toHaveProperty("consumer_level")
      expect(u).not.toHaveProperty("earned_titles")
    }
  })

  it("skips sheets at or below the grace floor", async () => {
    const svc = makeService([sheet({ spendable_xp: 100 })])
    const results = await svc.applyDemurrage({ rate: 0.1, minBalance: 100 })
    // listCharacterSheets filters $gt minBalance, so this sheet is excluded.
    expect(results).toEqual([])
    expect(svc.events).toHaveLength(0)
  })

  it("floors the balance at 0 and records a negative audit event", async () => {
    const svc = makeService([sheet({ spendable_xp: 50, total_xp: 5000 })])
    await svc.recordDemurrage("cus_1", 999)
    const update = svc.updates.find((u: any) => "spendable_xp" in u)
    expect(update.spendable_xp).toBe(0)
    expect(svc.events[0]).toMatchObject({ amount: -50, reason: "demurrage" })
  })

  it("is a no-op at rate 0", async () => {
    const svc = makeService([sheet({})])
    const results = await svc.applyDemurrage({ rate: 0, minBalance: 100 })
    expect(results).toEqual([])
  })

  it("runXpDemurrage delegates to the service", async () => {
    const progression: any = { applyDemurrage: jest.fn().mockResolvedValue([]) }
    await runXpDemurrage(progression, { rate: 0.02, minBalance: 100 })
    expect(progression.applyDemurrage).toHaveBeenCalledWith({ rate: 0.02, minBalance: 100 })
  })
})
