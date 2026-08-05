import handler from "../progression-demand-pool-fulfilled"
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

const fulfilled = (overrides: Record<string, unknown> = {}) => ({
  demand_post_id: "dp_1",
  organizer_id: "cus_organizer",
  organizer_type: "CUSTOMER",
  participant_ids: ["cus_a", "cus_b"],
  ...overrides,
})

describe("progression-demand-pool-fulfilled subscriber", () => {
  it("awards COALITION XP to the organizer and CONSUMER XP to participants", async () => {
    const progression = makeProgression()
    await run(fulfilled(), progression)

    // Both land on the same character sheet — one trust profile across modes.
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_organizer",
        role: Stance.COALITION,
        reason: "demand-pool-organized",
        source_module: "demand_pool",
      })
    )
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_a",
        role: Stance.CONSUMER,
        reason: "demand-pool-fulfilled",
      })
    )
    expect(progression.recordXpEvent).toHaveBeenCalledTimes(3)
  })

  it("does not pay an organizer twice for also participating", async () => {
    const progression = makeProgression()
    await run(
      fulfilled({ participant_ids: ["cus_organizer", "cus_b"] }),
      progression
    )

    const credited = progression.recordXpEvent.mock.calls.map(
      (c) => c[0].customer_id
    )
    expect(credited).toEqual(["cus_organizer", "cus_b"])
    expect(
      credited.filter((id: string) => id === "cus_organizer")
    ).toHaveLength(1)
  })

  it("scopes source_id per pool and role so a redelivered event cannot double-count", async () => {
    const progression = makeProgression()
    await run(fulfilled({ participant_ids: ["cus_a"] }), progression)

    const ids = progression.recordXpEvent.mock.calls.map((c) => c[0].source_id)
    expect(ids).toEqual(["dp_1-organizer", "dp_1-cus_a"])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("skips a seller organizer, who progresses through the Quest Engine", async () => {
    const progression = makeProgression()
    await run(fulfilled({ organizer_type: "SELLER" }), progression)

    const credited = progression.recordXpEvent.mock.calls.map(
      (c) => c[0].customer_id
    )
    expect(credited).not.toContain("cus_organizer")
    expect(credited).toEqual(["cus_a", "cus_b"])
  })

  it("handles a pool with no participants", async () => {
    const progression = makeProgression()
    await run(fulfilled({ participant_ids: [] }), progression)

    expect(progression.recordXpEvent).toHaveBeenCalledTimes(1)
    expect(progression.recomputeAggregates).toHaveBeenCalledTimes(1)
  })

  it("recomputes aggregates once per credited member", async () => {
    const progression = makeProgression()
    await run(fulfilled(), progression)

    expect(progression.recomputeAggregates).toHaveBeenCalledTimes(3)
  })

  it("swallows errors so XP never breaks the fulfillment flow", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockRejectedValue(new Error("boom")),
      recomputeAggregates: jest.fn(),
    }

    await expect(run(fulfilled(), progression)).resolves.toBeUndefined()
  })
})
