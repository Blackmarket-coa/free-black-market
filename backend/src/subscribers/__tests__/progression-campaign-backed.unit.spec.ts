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
  it("awards INVESTOR XP for a MICRO_INVESTOR backing, 1 XP per currency unit", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_1", campaign_id: "c_1", backer_id: "cus_1", mode: "MICRO_INVESTOR", amount: 5000 },
      progression
    )
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "cus_1", role: Stance.INVESTOR, amount: 50, reason: "campaign-backed" })
    )
    expect(progression.recomputeAggregates).toHaveBeenCalled()
  })

  it("awards CONSUMER XP for a PRE_ORDER backing", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { backing_id: "b_2", campaign_id: "c_1", backer_id: "cus_2", mode: "PRE_ORDER", amount: 100 },
      progression
    )
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ role: Stance.CONSUMER, amount: 1 })
    )
  })

  it("no-ops without a backer id", async () => {
    const progression = {
      recordXpEvent: jest.fn(),
      recomputeAggregates: jest.fn(),
    }
    await run({ backing_id: "b_3", mode: "MICRO_INVESTOR", amount: 100 }, progression)
    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("swallows errors so XP never breaks the backing flow", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockRejectedValue(new Error("boom")),
      recomputeAggregates: jest.fn(),
    }
    await expect(
      run({ backing_id: "b_4", backer_id: "cus_4", mode: "MICRO_INVESTOR", amount: 100 }, progression)
    ).resolves.toBeUndefined()
  })
})
