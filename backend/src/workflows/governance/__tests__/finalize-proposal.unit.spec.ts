/**
 * Threshold arithmetic for garden proposals.
 *
 * This is the only real threshold arithmetic in the ecosystem, and until
 * `jobs/close-garden-proposals.ts` it had no callers, so none of it had ever
 * run against a real proposal. docs/TRANSMUTATION_STRATEGY.md §5.4 makes
 * getting it right a precondition for any surface calling itself democratic.
 */
import {
  decideProposalOutcome,
  UnknownElectorateError,
} from "../finalize-proposal"

const tally = (over: Partial<Parameters<typeof decideProposalOutcome>[0]> = {}) => ({
  votesFor: 0,
  votesAgainst: 0,
  uniqueVoters: 0,
  eligibleVoters: 10,
  quorumRequired: 50,
  approvalThreshold: 50,
  ...over,
})

describe("quorum", () => {
  it("measures turnout as unique voters over the electorate", () => {
    // 5 of 10 voted, quorum is 50% — met exactly.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 5, votesFor: 5 }),
      "p_1"
    )
    expect(out.quorumMet).toBe(true)
    expect(out.status).toBe("passed")
  })

  it("expires a proposal that misses quorum, however lopsided the vote", () => {
    // 4 of 10 voted, all in favour: unanimous, but not enough of the garden
    // turned out for the result to bind.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 4, votesFor: 4 }),
      "p_1"
    )
    expect(out.quorumMet).toBe(false)
    expect(out.status).toBe("expired")
  })

  it.each([null, undefined, 0, -1])(
    "refuses to decide when the electorate is %p",
    (eligibleVoters) => {
      // The old code read this as `|| 1`, making one ballot 100% turnout and
      // quorum met unconditionally on a number nobody set.
      expect(() =>
        decideProposalOutcome(
          tally({ eligibleVoters: eligibleVoters as number | null, uniqueVoters: 1, votesFor: 1 }),
          "p_1"
        )
      ).toThrow(UnknownElectorateError)
    }
  )

  it("names the proposal in the refusal so a sweep log is actionable", () => {
    expect(() =>
      decideProposalOutcome(tally({ eligibleVoters: null }), "prop_42")
    ).toThrow(/prop_42/)
  })
})

describe("approval", () => {
  it("excludes abstains from the approval ratio but counts them as turnout", () => {
    // 8 of 10 turned out: 3 for, 1 against, 4 abstained. Approval is 3/4 = 75%,
    // not 3/8 — an abstention is participation, not an opinion.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 8, votesFor: 3, votesAgainst: 1 }),
      "p_1"
    )
    expect(out.quorumMet).toBe(true)
    expect(out.approvalPercentage).toBe(75)
    expect(out.status).toBe("passed")
  })

  it("rejects when approval is below the threshold", () => {
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 10, votesFor: 3, votesAgainst: 7 }),
      "p_1"
    )
    expect(out.status).toBe("rejected")
  })

  it("rejects an all-abstain proposal that met quorum", () => {
    // Everyone showed up and nobody took a position: 0% approval, not a tie.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 10, votesFor: 0, votesAgainst: 0 }),
      "p_1"
    )
    expect(out.quorumMet).toBe(true)
    expect(out.approvalPercentage).toBe(0)
    expect(out.status).toBe("rejected")
  })
})

describe("the tie branch", () => {
  it("calls an even split under simple majority a tie, not a pass", () => {
    // The regression this locks in: with `approvalPercentage >= threshold`
    // tested first, 50 >= 50 took the `passed` branch and `tie` was
    // unreachable. An even split is not a majority.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 10, votesFor: 5, votesAgainst: 5 }),
      "p_1"
    )
    expect(out.approvalPercentage).toBe(50)
    expect(out.status).toBe("tie")
  })

  it("passes a proposal that meets a supermajority exactly", () => {
    // 2 of 3 is 66.67% against a 66% bar — clearing the bar, not tying.
    const out = decideProposalOutcome(
      tally({
        uniqueVoters: 3,
        eligibleVoters: 3,
        votesFor: 2,
        votesAgainst: 1,
        approvalThreshold: 66,
      }),
      "p_1"
    )
    expect(out.status).toBe("passed")
  })

  it("does not tie an even split when the bar is not half", () => {
    // 5 for, 5 against against a 66% bar is a rejection: it fails the bar
    // outright rather than needing a casting decision.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 10, votesFor: 5, votesAgainst: 5, approvalThreshold: 66 }),
      "p_1"
    )
    expect(out.status).toBe("rejected")
  })

  it("expires rather than ties when an even split misses quorum", () => {
    // Quorum is checked first: an unrepresentative split is not a tie to
    // resolve, it is a vote that did not happen.
    const out = decideProposalOutcome(
      tally({ uniqueVoters: 2, votesFor: 1, votesAgainst: 1 }),
      "p_1"
    )
    expect(out.status).toBe("expired")
  })
})
