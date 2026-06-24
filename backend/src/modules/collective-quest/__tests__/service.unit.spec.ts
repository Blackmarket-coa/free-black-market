/**
 * Cooperative-quest service unit tests.
 *
 * Exercised on a prototype instance with persistence stubbed by an in-memory
 * store, asserting the ethics-load-bearing rules from ADR-0004:
 *   - boss HP drops ONLY on verified contributions
 *   - completing a quest splits the reward pool across distinct contributors
 *   - goal snapshot reads the source module (never re-sums)
 *   - the leaderboard excludes members who did not opt in
 */
import CollectiveQuestModuleService, {
  contributionBand,
} from "../service"
import { GoalScopeType, GoalStatus } from "../models/collective-goal"
import { QuestStatus } from "../models/collective-quest"

function makeService(seed: {
  quests?: any[]
  goals?: any[]
}) {
  const svc: any = Object.create(CollectiveQuestModuleService.prototype)
  const quests = new Map((seed.quests ?? []).map((q) => [q.id, { ...q }]))
  const goals = new Map((seed.goals ?? []).map((g) => [g.id, { ...g }]))
  svc.contributions = [] as any[]
  svc.grants = [] as any[]

  svc.retrieveCollectiveQuest = jest.fn(async (id: string) => quests.get(id))
  svc.updateCollectiveQuests = jest.fn(async (patch: any) => {
    quests.set(patch.id, { ...quests.get(patch.id), ...patch })
    return [patch]
  })
  svc.listCollectiveQuests = jest.fn(async (filter: any = {}) =>
    [...quests.values()].filter((q: any) =>
      Object.entries(filter).every(([k, v]) =>
        Array.isArray(v) ? (v as any[]).includes(q[k]) : q[k] === v
      )
    )
  )
  svc.createQuestContributions = jest.fn(async (c: any) => {
    svc.contributions.push(c)
    return [c]
  })
  svc.listQuestContributions = jest.fn(async (filter: any = {}) =>
    svc.contributions.filter((c: any) =>
      Object.entries(filter).every(([k, v]) =>
        Array.isArray(v) ? (v as any[]).includes(c[k]) : c[k] === v
      )
    )
  )
  svc.createQuestRewardGrants = jest.fn(async (g: any) => {
    svc.grants.push(g)
    return [g]
  })
  svc.retrieveCollectiveGoal = jest.fn(async (id: string) => goals.get(id))
  svc.updateCollectiveGoals = jest.fn(async (patch: any) => {
    goals.set(patch.id, { ...goals.get(patch.id), ...patch })
    return [patch]
  })
  return svc as CollectiveQuestModuleService & Record<string, any>
}

const quest = (over: any = {}) => ({
  id: "q_1",
  den_id: "den_1",
  status: QuestStatus.ACTIVE,
  boss_hp: 100,
  hp_remaining: 100,
  reward_pool_xp: 300,
  ...over,
})

describe("contributeToQuest", () => {
  it("does NOT drop HP for an unverified contribution", async () => {
    const svc = makeService({ quests: [quest()] })
    await svc.contributeToQuest({ quest_id: "q_1", customer_id: "cus_1", hp_reduction: 40, verified: false })
    expect(svc.updateCollectiveQuests).not.toHaveBeenCalledWith(
      expect.objectContaining({ hp_remaining: expect.anything() })
    )
  })

  it("drops HP for a verified contribution", async () => {
    const svc = makeService({ quests: [quest()] })
    await svc.contributeToQuest({ quest_id: "q_1", customer_id: "cus_1", hp_reduction: 40, verified: true })
    expect(svc.updateCollectiveQuests).toHaveBeenCalledWith({ id: "q_1", hp_remaining: 60 })
  })

  it("auto-completes and awards XP when HP reaches 0", async () => {
    const svc = makeService({ quests: [quest({ hp_remaining: 30, reward_pool_xp: 300 })] })
    // Two distinct prior verified contributors already on the ledger.
    svc.contributions.push(
      { quest_id: "q_1", customer_id: "cus_1", hp_reduction: 10, verified: true },
      { quest_id: "q_1", customer_id: "cus_2", hp_reduction: 10, verified: true }
    )
    const awardXp = jest.fn().mockResolvedValue(undefined)
    await svc.contributeToQuest(
      { quest_id: "q_1", customer_id: "cus_1", hp_reduction: 30, verified: true },
      { awardXp }
    )
    expect(svc.updateCollectiveQuests).toHaveBeenCalledWith({ id: "q_1", status: QuestStatus.COMPLETE })
    // pool 300 / 2 distinct contributors = 150 each
    expect(awardXp).toHaveBeenCalledWith("cus_1", 150)
    expect(awardXp).toHaveBeenCalledWith("cus_2", 150)
  })

  it("throws on a non-active quest", async () => {
    const svc = makeService({ quests: [quest({ status: QuestStatus.COMPLETE })] })
    await expect(
      svc.contributeToQuest({ quest_id: "q_1", customer_id: "cus_1", hp_reduction: 10, verified: true })
    ).rejects.toThrow("not active")
  })
})

describe("completeQuest", () => {
  it("splits the reward pool across distinct verified contributors only", async () => {
    const svc = makeService({ quests: [quest({ reward_pool_xp: 300 })] })
    svc.contributions.push(
      { quest_id: "q_1", customer_id: "cus_1", hp_reduction: 10, verified: true },
      { quest_id: "q_1", customer_id: "cus_1", hp_reduction: 10, verified: true },
      { quest_id: "q_1", customer_id: "cus_2", hp_reduction: 10, verified: true },
      { quest_id: "q_1", customer_id: "cus_3", hp_reduction: 10, verified: false }
    )
    await svc.completeQuest("q_1")
    const granted = svc.grants.map((g: any) => g.customer_id).sort()
    expect(granted).toEqual(["cus_1", "cus_2"]) // cus_3 unverified, cus_1 deduped
    expect(svc.grants.every((g: any) => g.xp_amount === 150)).toBe(true)
  })

  it("is idempotent on a completed quest", async () => {
    const svc = makeService({ quests: [quest({ status: QuestStatus.COMPLETE })] })
    await svc.completeQuest("q_1")
    expect(svc.grants).toHaveLength(0)
  })
})

describe("recomputeGoal", () => {
  it("snapshots TREASURY progress from collective_campaign, never re-sums", async () => {
    const svc = makeService({
      goals: [
        {
          id: "g_1",
          scope_type: GoalScopeType.TREASURY,
          scope_id: "camp_1",
          target_value: 1000,
          current_value: 0,
          status: GoalStatus.ACTIVE,
        },
      ],
    })
    const query = {
      graph: jest.fn().mockResolvedValue({ data: [{ total_backed_amount: 1000 }] }),
    }
    await svc.recomputeGoal("g_1", query as never)
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "collective_campaign" })
    )
    expect(svc.updateCollectiveGoals).toHaveBeenCalledWith(
      expect.objectContaining({ id: "g_1", current_value: 1000, status: GoalStatus.COMPLETE })
    )
  })

  it("leaves the snapshot unchanged when the source module is absent", async () => {
    const svc = makeService({
      goals: [
        { id: "g_2", scope_type: GoalScopeType.TREASURY, scope_id: "camp_x", target_value: 100, current_value: 5 },
      ],
    })
    const query = { graph: jest.fn().mockRejectedValue(new Error("no module")) }
    await svc.recomputeGoal("g_2", query as never)
    expect(svc.updateCollectiveGoals).not.toHaveBeenCalled()
  })
})

describe("getDenLeaderboard", () => {
  it("excludes members who did not opt in and exposes no rank", async () => {
    const svc = makeService({ quests: [quest()] })
    svc.contributions.push(
      { quest_id: "q_1", customer_id: "cus_optin", hp_reduction: 120, verified: true, metadata: { leaderboard_opt_in: true } },
      { quest_id: "q_1", customer_id: "cus_private", hp_reduction: 500, verified: true, metadata: { leaderboard_opt_in: false } }
    )
    const entries = await svc.getDenLeaderboard("den_1", { optInOnly: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ customer_id: "cus_optin", contribution: 120, band: "sprout" })
    expect(entries[0]).not.toHaveProperty("rank")
  })
})

describe("contributionBand", () => {
  it("buckets self-relative bands", () => {
    expect(contributionBand(0)).toBe("seedling")
    expect(contributionBand(100)).toBe("sprout")
    expect(contributionBand(500)).toBe("grove")
  })
})
