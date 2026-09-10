import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const GOVERNANCE_MODULE = "governanceModuleService"

interface GovernanceServiceType {
  updateGardenProposals: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * Finalize Proposal Workflow
 *
 * Calculates final results and updates proposal status. This is the only real
 * threshold arithmetic in either repo; `jobs/close-garden-proposals.ts` is its
 * only caller, sweeping proposals whose `voting_end` has passed.
 *
 * See docs/TRANSMUTATION_STRATEGY.md §5.4 for why the arithmetic has to be
 * right before any surface says "democratic".
 */

type FinalizeProposalInput = {
  proposal_id: string
}

/**
 * Raised when a proposal cannot be finalized because its quorum denominator is
 * unknown.
 *
 * `eligible_voters` is nullable and **nothing in the tree writes it**. The
 * original code read it as `(proposal.eligible_voters as number) || 1`, so an
 * unset denominator meant one eligible voter, which meant a single ballot was
 * 100% turnout and quorum was met unconditionally — for every proposal, at
 * every quorum setting. Silently passing that test is worse than refusing it:
 * it reports "quorum met" on a number nobody set.
 */
export class UnknownElectorateError extends Error {
  constructor(public readonly proposalId: string) {
    super(
      `Proposal ${proposalId} has no eligible_voters recorded, so turnout ` +
        `cannot be measured against its quorum. Record the electorate before ` +
        `finalizing.`
    )
    this.name = "UnknownElectorateError"
  }
}

export type ProposalTally = {
  votesFor: number
  votesAgainst: number
  uniqueVoters: number
  /** Size of the electorate. Must be a positive number; see UnknownElectorateError. */
  eligibleVoters: number | null | undefined
  /** Percentage of the electorate that must vote for the result to count. */
  quorumRequired: number
  /** Percentage of considered votes that must be "for" to pass. */
  approvalThreshold: number
}

export type ProposalOutcome = {
  status: "expired" | "tie" | "passed" | "rejected"
  quorumMet: boolean
  approvalPercentage: number
}

/**
 * Decide a proposal's outcome from its tally.
 *
 * Pure and exported so the arithmetic can be tested directly — it is the only
 * real threshold arithmetic in the ecosystem, and §5.4 makes it a precondition
 * for any surface calling itself democratic.
 *
 * Abstentions count toward turnout (they are participation) but not toward the
 * approval ratio (they are not an opinion), which is the conventional reading
 * and matches how `unique_voters` is incremented.
 */
export function decideProposalOutcome(tally: ProposalTally, proposalId: string): ProposalOutcome {
  // No `|| 1` fallback: an unknown electorate is refused, not guessed.
  const eligibleVoters = tally.eligibleVoters
  if (!eligibleVoters || eligibleVoters <= 0) {
    throw new UnknownElectorateError(proposalId)
  }

  const voterTurnout = (tally.uniqueVoters / eligibleVoters) * 100
  const quorumMet = voterTurnout >= tally.quorumRequired

  // Approval excludes abstains.
  const votesConsidered = tally.votesFor + tally.votesAgainst
  const approvalPercentage =
    votesConsidered > 0 ? (tally.votesFor / votesConsidered) * 100 : 0

  // The tie test comes *before* the pass test, and did not used to. With
  // `approvalPercentage >= approvalThreshold` evaluated first, a 50/50 split
  // under a simple-majority threshold took the `passed` branch and the `tie`
  // branch was unreachable — the model declares a `tie` status that nothing
  // could ever produce. An even split is not a majority.
  //
  // The test is on the raw counts rather than on `approvalPercentage === 50`
  // because the percentage is a float; and it is scoped to a 50% threshold
  // because an even split only ties when half is the bar. Meeting a 66%
  // supermajority exactly is passing it, not tying it.
  const isEvenSplit =
    votesConsidered > 0 &&
    tally.votesFor === tally.votesAgainst &&
    tally.approvalThreshold === 50

  let status: ProposalOutcome["status"]
  if (!quorumMet) {
    status = "expired"
  } else if (isEvenSplit) {
    status = "tie"
  } else if (approvalPercentage >= tally.approvalThreshold) {
    status = "passed"
  } else {
    status = "rejected"
  }

  return { status, quorumMet, approvalPercentage }
}

const finalizeProposalStep = createStep(
  "finalize-proposal-step",
  async (input: FinalizeProposalInput, { container }) => {
    const governanceService = container.resolve(GOVERNANCE_MODULE) as GovernanceServiceType
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get proposal
    const { data: [proposal] } = await query.graph({
      entity: "garden_proposal",
      fields: [
        "id",
        "garden_id",
        "status",
        "voting_end",
        "votes_for",
        "votes_against",
        "votes_abstain",
        "total_voting_power",
        "unique_voters",
        "quorum_required",
        "approval_threshold",
        "eligible_voters",
        "eligible_voting_power",
      ],
      filters: { id: input.proposal_id },
    })

    if (!proposal) {
      throw new Error("Proposal not found")
    }

    if (proposal.status !== "active") {
      throw new Error("Proposal is not active")
    }

    const votesFor = proposal.votes_for as number
    const votesAgainst = proposal.votes_against as number
    const uniqueVoters = proposal.unique_voters as number

    const {
      status: newStatus,
      quorumMet,
      approvalPercentage,
    } = decideProposalOutcome(
      {
        votesFor,
        votesAgainst,
        uniqueVoters,
        eligibleVoters: proposal.eligible_voters as number | null,
        quorumRequired: proposal.quorum_required as number,
        approvalThreshold: proposal.approval_threshold as number,
      },
      input.proposal_id
    )

    // Update proposal
    const previousStatus = proposal.status
    await governanceService.updateGardenProposals({
      id: input.proposal_id,
      status: newStatus,
      result_calculated_at: new Date(),
      quorum_met: quorumMet,
      approval_percentage: approvalPercentage,
    })

    return new StepResponse({
      proposal_id: input.proposal_id,
      status: newStatus,
      quorum_met: quorumMet,
      approval_percentage: approvalPercentage,
      votes_for: votesFor,
      votes_against: votesAgainst,
      unique_voters: uniqueVoters,
    }, { proposalId: input.proposal_id, previousStatus })
  },
  async (context, { container }) => {
    if (!context) return
    
    const governanceService = container.resolve(GOVERNANCE_MODULE) as GovernanceServiceType
    await governanceService.updateGardenProposals({
      id: context.proposalId,
      status: context.previousStatus,
      result_calculated_at: null,
      quorum_met: null,
      approval_percentage: null,
    })
  }
)

export const finalizeProposalWorkflow = createWorkflow(
  "finalize-garden-proposal-workflow",
  (input: FinalizeProposalInput) => {
    const result = finalizeProposalStep(input)
    return new WorkflowResponse(result)
  }
)
