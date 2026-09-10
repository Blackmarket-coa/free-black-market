/**
 * Unit tests for the garden-proposal closing sweep.
 *
 * The sweep exists because `finalizeProposalWorkflow` had no callers and
 * proposals stayed `active` past their voting period for ever. What matters
 * here is the skip rule (an unknown electorate is refused, not guessed) and
 * per-proposal isolation. docs/TRANSMUTATION_STRATEGY.md §5.4.
 */
import { closeOverdueProposals } from "../close-garden-proposals"

describe("closeOverdueProposals", () => {
  it("finalizes each proposal that has a recorded electorate", async () => {
    const finalize = jest.fn().mockResolvedValue(undefined)
    const results = await closeOverdueProposals(
      [
        { id: "prop_1", eligible_voters: 40 },
        { id: "prop_2", eligible_voters: 12 },
      ],
      finalize
    )

    expect(finalize).toHaveBeenCalledTimes(2)
    expect(finalize).toHaveBeenCalledWith("prop_1")
    expect(finalize).toHaveBeenCalledWith("prop_2")
    expect(results.every((r) => r.outcome === "closed")).toBe(true)
  })

  it("skips a proposal with no recorded electorate rather than closing it", async () => {
    // Quorum is unique_voters / eligible_voters. With no denominator the old
    // code substituted 1, so one ballot was 100% turnout and quorum was met
    // unconditionally. Staying visibly open beats being falsely resolved.
    const finalize = jest.fn().mockResolvedValue(undefined)
    const results = await closeOverdueProposals(
      [{ id: "prop_1", eligible_voters: null }],
      finalize
    )

    expect(finalize).not.toHaveBeenCalled()
    expect(results).toEqual([
      { proposal_id: "prop_1", outcome: "skipped_unknown_electorate" },
    ])
  })

  it.each([undefined, null, 0, -3])(
    "treats %p as an unknown electorate",
    async (electorate) => {
      const finalize = jest.fn().mockResolvedValue(undefined)
      const results = await closeOverdueProposals(
        [{ id: "prop_1", eligible_voters: electorate as number | null }],
        finalize
      )
      expect(finalize).not.toHaveBeenCalled()
      expect(results[0].outcome).toBe("skipped_unknown_electorate")
    }
  )

  it("keeps going when one proposal fails, and records why", async () => {
    const finalize = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined)

    const results = await closeOverdueProposals(
      [
        { id: "prop_bad", eligible_voters: 10 },
        { id: "prop_good", eligible_voters: 10 },
      ],
      finalize
    )

    expect(finalize).toHaveBeenCalledTimes(2)
    expect(results).toEqual([
      { proposal_id: "prop_bad", outcome: "failed", error: "boom" },
      { proposal_id: "prop_good", outcome: "closed" },
    ])
  })

  it("is a no-op on an empty sweep", async () => {
    const finalize = jest.fn()
    expect(await closeOverdueProposals([], finalize)).toEqual([])
    expect(finalize).not.toHaveBeenCalled()
  })
})
