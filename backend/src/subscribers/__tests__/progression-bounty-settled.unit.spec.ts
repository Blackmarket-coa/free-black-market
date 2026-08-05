import handler from "../progression-bounty-settled"
import { Stance } from "../../modules/progression/stance"

const makeContainer = (progression: Record<string, jest.Mock>) => ({
  resolve: (token: string) => {
    if (token === "query") return { graph: jest.fn() }
    if (token === "progressionModuleService") return progression
    return {}
  },
})

const makeProgression = () => ({
  recordXpEvent: jest.fn().mockResolvedValue(undefined),
  recomputeAggregates: jest.fn().mockResolvedValue(undefined),
})

const run = (data: Record<string, unknown>, progression: Record<string, jest.Mock>) =>
  handler({ event: { data }, container: makeContainer(progression) } as any)

const settled = (overrides: Record<string, unknown> = {}) => ({
  bounty_id: "bnt_1",
  demand_post_id: "dp_1",
  milestone_index: 0,
  assignee_id: "cus_1",
  assignee_type: "CUSTOMER",
  objective: "FIND_SUPPLIER",
  payout_amount: 40,
  ...overrides,
})

describe("progression-bounty-settled subscriber", () => {
  it("awards COALITION XP so bounty work lands on the shared trust profile", async () => {
    const progression = makeProgression()
    await run(settled(), progression)

    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_1",
        role: Stance.COALITION,
        amount: 40,
        reason: "bounty-milestone-settled",
        source_module: "demand_bounty",
      })
    )
    expect(progression.recomputeAggregates).toHaveBeenCalled()
  })

  it("routes creator-facing objectives to the CREATOR track", async () => {
    const progression = makeProgression()
    await run(settled({ objective: "PHOTOGRAPHY_NEEDED" }), progression)

    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ role: Stance.CREATOR })
    )
  })

  it("scopes source_id per milestone so a replay cannot double-count", async () => {
    const progression = makeProgression()
    await run(settled({ milestone_index: 2 }), progression)

    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source_id: "bnt_1-m2" })
    )
  })

  it("floors sub-unit payouts at 1 XP", async () => {
    const progression = makeProgression()
    await run(settled({ payout_amount: 0.4 }), progression)

    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1 })
    )
  })

  it("skips sellers, who progress through the Quest Engine instead", async () => {
    const progression = makeProgression()
    await run(settled({ assignee_type: "SELLER" }), progression)

    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("no-ops without an assignee", async () => {
    const progression = makeProgression()
    await run(settled({ assignee_id: null }), progression)

    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("swallows errors so XP never breaks the payout flow", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockRejectedValue(new Error("boom")),
      recomputeAggregates: jest.fn(),
    }

    await expect(run(settled(), progression)).resolves.toBeUndefined()
  })
})
