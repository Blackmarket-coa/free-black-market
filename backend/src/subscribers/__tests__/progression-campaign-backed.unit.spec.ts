import handler from "../progression-campaign-backed"
import { Stance } from "../../modules/progression/stance"

const makeContainer = (progression: Record<string, jest.Mock>) => ({
  resolve: (token: string) => {
    if (token === "query") return { graph: jest.fn() }
    if (token === "progressionModuleService") return progression
    return {}
  },
})

const run = (data: Record<string, unknown>, progression: Record<string, jest.Mock>) =>
  handler({ event: { data }, container: makeContainer(progression) } as any)

describe("progression-campaign-backed subscriber", () => {
  it("awards no XP for a MICRO_INVESTOR backing", async () => {
    // Reputation must not be a function of capital deployed. Awarding XP here
    // closed a loop with `producer.reduced-commission` and
    // `investor.priority-campaigns` — pay in, level up, pay a lower fee, get
    // into the next raise earlier. Both privileges are deleted and this award
    // is gone with them. docs/TRANSMUTATION_STRATEGY.md §3.4.
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_1", campaign_id: "c_1", backer_id: "cus_1", mode: "MICRO_INVESTOR", amount: 5000 },
      progression
    )
    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("still refreshes the capital-deployed snapshot for a MICRO_INVESTOR backing", async () => {
    // Capital is still recorded as capital — it just no longer buys XP.
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_1", campaign_id: "c_1", backer_id: "cus_1", mode: "MICRO_INVESTOR", amount: 5000 },
      progression
    )
    expect(progression.recomputeAggregates).toHaveBeenCalledWith("cus_1", expect.anything())
  })

  it("awards CONSUMER XP for a PRE_ORDER backing, 1 XP per currency unit", async () => {
    // A pre-order is a forward purchase: ordinary commerce, ordinary loyalty XP.
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_2", campaign_id: "c_1", backer_id: "cus_2", mode: "PRE_ORDER", amount: 5000 },
      progression
    )
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_2",
        role: Stance.CONSUMER,
        amount: 50,
        reason: "campaign-backed",
      })
    )
    expect(progression.recomputeAggregates).toHaveBeenCalled()
  })

  it("floors a sub-unit pre-order at 1 XP", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_5", campaign_id: "c_1", backer_id: "cus_5", mode: "PRE_ORDER", amount: 20 },
      progression
    )
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1 })
    )
  })

  it("never awards INVESTOR XP, whatever the mode", async () => {
    // Nothing in the tree writes the INVESTOR track any more; this is the
    // subscriber that used to. See modules/progression/stance.ts.
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    for (const mode of ["MICRO_INVESTOR", "PRE_ORDER", "SOMETHING_ELSE"]) {
      await run(
        { backing_id: `b_${mode}`, campaign_id: "c_1", backer_id: "cus_6", mode, amount: 100 },
        progression
      )
    }
    for (const call of progression.recordXpEvent.mock.calls) {
      expect(call[0].role).not.toBe(Stance.INVESTOR)
    }
  })

  it("no-ops without a backer id", async () => {
    const progression = {
      recordXpEvent: jest.fn(),
      recomputeAggregates: jest.fn(),
    }
    await run({ backing_id: "b_3", mode: "PRE_ORDER", amount: 100 }, progression)
    expect(progression.recordXpEvent).not.toHaveBeenCalled()
    expect(progression.recomputeAggregates).not.toHaveBeenCalled()
  })

  it("swallows errors so XP never breaks the backing flow", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockRejectedValue(new Error("boom")),
      recomputeAggregates: jest.fn(),
    }
    await expect(
      run({ backing_id: "b_4", backer_id: "cus_4", mode: "PRE_ORDER", amount: 100 }, progression)
    ).resolves.toBeUndefined()
  })
})
