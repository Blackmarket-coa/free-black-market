import handler from "../progression-mutual-aid-fulfilled"
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

const fulfilled = (over: Record<string, unknown> = {}) => ({
  request_id: "mar_1",
  helper_id: "cus_helper",
  requester_id: "cus_asker",
  category: "food",
  urgency: "ROUTINE",
  ...over,
})

describe("progression-mutual-aid-fulfilled subscriber", () => {
  it("awards COALITION XP — the same track as bounties and group buys", async () => {
    const progression = makeProgression()
    await run(fulfilled(), progression)

    // The point of Phase 2: trust carries across modes rather than piling up
    // in parallel columns that happen to share a table.
    expect(progression.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_helper",
        role: Stance.COALITION,
        reason: "mutual-aid-fulfilled",
        source_module: "mutual_aid",
        source_id: "mar_1",
      })
    )
    expect(progression.recomputeAggregates).toHaveBeenCalledWith(
      "cus_helper",
      expect.anything()
    )
  })

  it("does not pay more for an URGENT request", async () => {
    const routine = makeProgression()
    await run(fulfilled({ urgency: "ROUTINE" }), routine)

    const urgent = makeProgression()
    await run(fulfilled({ urgency: "URGENT" }), urgent)

    // Paying more for urgency would create a reason to overstate it on a board
    // read by people in need.
    expect(urgent.recordXpEvent.mock.calls[0][0].amount).toBe(
      routine.recordXpEvent.mock.calls[0][0].amount
    )
  })

  it("refuses to award XP for helping yourself", async () => {
    const progression = makeProgression()
    await run(
      fulfilled({ helper_id: "cus_same", requester_id: "cus_same" }),
      progression
    )

    // Self-help would mint reputation from nothing. The service refuses it too;
    // this is the second lock on the same door.
    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("no-ops without a helper", async () => {
    const progression = makeProgression()
    await run(fulfilled({ helper_id: null }), progression)

    expect(progression.recordXpEvent).not.toHaveBeenCalled()
  })

  it("scopes source_id per request so a replay cannot double-count", async () => {
    const progression = makeProgression()
    await run(fulfilled({ request_id: "mar_99" }), progression)

    expect(progression.recordXpEvent.mock.calls[0][0].source_id).toBe("mar_99")
  })

  it("swallows errors so XP never breaks a confirmation", async () => {
    const progression = {
      recordXpEvent: jest.fn().mockRejectedValue(new Error("boom")),
      recomputeAggregates: jest.fn(),
    }

    await expect(run(fulfilled(), progression)).resolves.toBeUndefined()
  })
})
