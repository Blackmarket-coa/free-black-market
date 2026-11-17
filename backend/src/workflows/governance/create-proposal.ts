import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { GOVERNANCE_MODULE } from "../../modules/governance"

interface GovernanceServiceType {
  createGardenProposals: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteGardenProposals: (id: string) => Promise<void>
}

/**
 * Create Garden Proposal Workflow
 * 
 * Creates a new governance proposal for a garden.
 */

type CreateProposalInput = {
  garden_id: string
  title: string
  description: string
  summary?: string
  proposal_type: string
  proposed_by_id: string
  voting_start: Date
  voting_end: Date
  quorum_required?: number
  approval_threshold?: number
  budget_request?: Record<string, unknown>
  policy_changes?: Record<string, unknown>
}

const createProposalStep = createStep(
  "create-garden-proposal-step",
  async (input: CreateProposalInput, { container }) => {
    const governanceService = container.resolve(GOVERNANCE_MODULE) as GovernanceServiceType

    const proposal = await governanceService.createGardenProposals({
      garden_id: input.garden_id,
      title: input.title,
      description: input.description,
      summary: input.summary,
      proposal_type: input.proposal_type,
      proposed_by_id: input.proposed_by_id,
      voting_start: input.voting_start,
      voting_end: input.voting_end,
      quorum_required: input.quorum_required || 50,
      approval_threshold: input.approval_threshold || 51,
      status: new Date() >= input.voting_start ? "active" : "submitted",
      votes_for: 0,
      votes_against: 0,
      votes_abstain: 0,
      total_voting_power: 0,
      unique_voters: 0,
      budget_request: input.budget_request,
      policy_changes: input.policy_changes,
      discussion_enabled: true,
    })

    return new StepResponse(proposal, proposal.id)
  },
  async (proposalId, { container }) => {
    if (!proposalId) return
    const governanceService = container.resolve(GOVERNANCE_MODULE) as GovernanceServiceType
    await governanceService.deleteGardenProposals(proposalId)
  }
)

export const createGardenProposalWorkflow = createWorkflow(
  "create-garden-proposal-workflow",
  (input: CreateProposalInput) => {
    const proposal = createProposalStep(input)
    return new WorkflowResponse(proposal)
  }
)
