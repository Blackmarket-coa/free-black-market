import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"

const GOVERNANCE_MODULE = "governanceModuleService"

interface GovernanceServiceType {
  createGardenVotes: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateGardenProposals: (data: Record<string, unknown>) => Promise<{ id: string }>
}

// Inline voting power calculation
function calculateVotingPower(params: {
  governance_model: string
  base_votes: number
  labor_hours: number
  investment_amount: number
  role_bonus: number
  weights?: { labor_weight?: number; investment_weight?: number } | null
}): number {
  const { governance_model, base_votes, labor_hours, investment_amount, weights } = params
  
  if (governance_model === "one_member_one_vote") {
    return 1
  }
  
  const laborWeight = weights?.labor_weight || 0.5
  const investmentWeight = weights?.investment_weight || 0.5
  
  const laborBonus = Math.floor(labor_hours / 10) * laborWeight
  const investmentBonus = Math.floor(investment_amount / 100) * investmentWeight
  
  return base_votes + laborBonus + investmentBonus
}

/**
 * GET /store/proposals/:id/votes
 * 
 * Get votes for a proposal
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: votes } = await query.graph({
    entity: "garden_vote",
    fields: [
      "id",
      "customer_id",
      "vote",
      "voting_power",
      "comment",
      "comment_visibility",
      "voted_at",
      "is_delegated",
    ],
    filters: {
      proposal_id: id,
    },
  })

  res.json({ votes })
}

/**
 * POST /store/proposals/:id/votes
 * 
 * Cast a vote on a proposal
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const governanceService = req.scope.resolve(GOVERNANCE_MODULE) as GovernanceServiceType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    customer_id,
    membership_id,
    vote,
    comment,
    comment_visibility,
  } = req.body as Record<string, unknown>

  // SEC: a customer may only vote as themselves. Ignore any body customer_id
  // for a logged-in customer and bind the vote to the authenticated actor —
  // otherwise the "already voted" dedupe (keyed on customer_id) and the vote
  // record could both be forged under another member's id. Non-customer actors
  // (seller/driver) fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveCustomerId = (actingCustomer ?? customer_id) as string

  // Get proposal
  const { data: [proposal] } = await query.graph({
    entity: "garden_proposal",
    fields: ["id", "garden_id", "status", "voting_end", "votes_for", "votes_against", "votes_abstain", "total_voting_power", "unique_voters"],
    filters: { id },
  })

  if (!proposal) {
    res.status(404).json({ message: "Proposal not found" })
    return
  }

  if (proposal.status !== "active") {
    res.status(400).json({ message: "Voting is not open for this proposal" })
    return
  }

  if (new Date() > new Date(proposal.voting_end as string)) {
    res.status(400).json({ message: "Voting period has ended" })
    return
  }

  // Check if already voted
  const { data: existingVotes } = await query.graph({
    entity: "garden_vote",
    fields: ["id"],
    filters: { proposal_id: id, customer_id: effectiveCustomerId },
  })

  if (existingVotes.length > 0) {
    res.status(400).json({ message: "You have already voted on this proposal" })
    return
  }

  // Get membership for voting power
  const { data: [membership] } = await query.graph({
    entity: "garden_membership",
    fields: ["id", "customer_id", "voting_power", "volunteer_hours_balance", "investment_balance", "roles"],
    filters: { id: membership_id as string },
  })

  // SEC: the membership supplies the voting power, so a customer must not be
  // able to borrow another member's membership_id. Reject a mismatch.
  if (
    actingCustomer &&
    membership &&
    membership.customer_id &&
    membership.customer_id !== actingCustomer
  ) {
    res.status(403).json({ message: "That membership is not yours" })
    return
  }

  // Get garden for governance model
  const { data: [garden] } = await query.graph({
    entity: "garden",
    fields: ["id", "governance_model", "settings"],
    filters: { id: proposal.garden_id },
  })

  // Extract voting weights from garden settings if available
  const gardenSettings = garden.settings as { voting_weights?: { labor_weight?: number; investment_weight?: number } } | null

  // Calculate voting power
  const voting_power = calculateVotingPower({
    governance_model: garden.governance_model as string,
    base_votes: 1,
    labor_hours: (membership?.volunteer_hours_balance as number) || 0,
    investment_amount: (membership?.investment_balance as number) || 0,
    role_bonus: 0,
    weights: gardenSettings?.voting_weights || null,
  })

  const voteRecord = await governanceService.createGardenVotes({
    proposal_id: id,
    garden_id: proposal.garden_id,
    customer_id: effectiveCustomerId,
    membership_id,
    vote,
    voting_power,
    power_basis: {
      base: 1,
      labor_hours: (membership?.volunteer_hours_balance as number) || 0,
      investment: (membership?.investment_balance as number) || 0,
    },
    comment,
    comment_visibility: (comment_visibility as string) || "public",
    is_delegated: false,
    is_final: true,
    voted_at: new Date(),
  })

  // Update proposal vote counts
  const voteUpdates: Record<string, unknown> = {
    id,
    total_voting_power: (proposal.total_voting_power as number) + voting_power,
    unique_voters: (proposal.unique_voters as number) + 1,
  }

  if (vote === "for") {
    voteUpdates.votes_for = (proposal.votes_for as number) + voting_power
  } else if (vote === "against") {
    voteUpdates.votes_against = (proposal.votes_against as number) + voting_power
  } else {
    voteUpdates.votes_abstain = (proposal.votes_abstain as number) + voting_power
  }

  await governanceService.updateGardenProposals(voteUpdates)

  res.status(201).json({ vote: voteRecord })
}
