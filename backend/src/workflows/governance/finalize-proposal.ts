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
 * Calculates final results and updates proposal status.
 */

type FinalizeProposalInput = {
  proposal_id: string
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

    // Calculate results
    const votesFor = proposal.votes_for as number
    const votesAgainst = proposal.votes_against as number
    const _votesAbstain = proposal.votes_abstain as number
    const uniqueVoters = proposal.unique_voters as number
    const quorumRequired = proposal.quorum_required as number
    const approvalThreshold = proposal.approval_threshold as number
    const eligibleVoters = (proposal.eligible_voters as number) || 1
    
    // Check quorum (based on unique voters if eligible_voters not set)
    const voterTurnout = (uniqueVoters / eligibleVoters) * 100
    const quorumMet = voterTurnout >= quorumRequired

    // Calculate approval percentage (excluding abstains)
    const votesConsidered = votesFor + votesAgainst
    const approvalPercentage = votesConsidered > 0 
      ? (votesFor / votesConsidered) * 100 
      : 0

    // Determine status
    let newStatus: string
    if (!quorumMet) {
      newStatus = "expired"
    } else if (approvalPercentage >= approvalThreshold) {
      newStatus = "passed"
    } else if (approvalPercentage === 50 && approvalThreshold === 50) {
      newStatus = "tie"
    } else {
      newStatus = "rejected"
    }

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
