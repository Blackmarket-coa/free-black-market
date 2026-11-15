import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"
import { forbidden } from "../../../../../shared/community-read-access"

import { GOVERNANCE_MODULE } from "../../../../../modules/governance"
import {
  isBallotChoice,
  type BallotInput,
} from "../../../../../modules/governance/service"

interface GovernanceServiceType {
  castBallot: (ballot: BallotInput) => Promise<{ id: string } | null>
}

const alreadyVoted = (res: MedusaResponse) =>
  res.status(400).json({ message: "You have already voted on this proposal" })

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

  // `comment_visibility` was selected and never applied, so a comment a voter
  // marked `private` or `members_only` was served to anonymous callers next
  // to their `customer_id`. The column is a promise the schema makes to a
  // voter; withholding the comment is the read path keeping it.
  //
  // Only the comment is withheld — the tally still needs every vote, its
  // weight and its voter, and a governance record that quietly dropped
  // ballots would be worse than one that shows a comment as withheld.
  // `members_only` is treated as non-public here because this route is
  // unauthenticated and cannot yet tell a member from a stranger; when it
  // can, that case can widen.
  const visibleVotes = (votes as Array<Record<string, unknown>>).map((vote) => {
    if (vote.comment_visibility === "public") {
      return vote
    }
    return { ...vote, comment: null, comment_withheld: true }
  })

  res.json({ votes: visibleVotes })
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
  // Customers only. This record is written under a customer id, and that id
  // comes from the token. A seller or driver token used to fall through to
  // the id in the body, which let any signed-in seller or driver act as any
  // customer here.
  const actingCustomer = actingCustomerId(req)
  if (!actingCustomer) {
    return forbidden(res)
  }

  const { id } = req.params
  const governanceService = req.scope.resolve(GOVERNANCE_MODULE) as GovernanceServiceType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    membership_id,
    vote,
    comment,
    comment_visibility,
  } = req.body as Record<string, unknown>

  // The choice picks the tally column the ballot is added to.
  if (!isBallotChoice(vote)) {
    res.status(400).json({ message: "vote must be one of: for, against, abstain" })
    return
  }
  // Refused rather than defaulted: a mistyped "Private" must not publish the
  // comment. (It used to reach the column's check constraint, a 500.)
  const visibility = comment_visibility ?? "public"
  if (visibility !== "public" && visibility !== "members_only" && visibility !== "private") {
    res.status(400).json({ message: "comment_visibility must be one of: public, members_only, private" })
    return
  }

  // SEC: a customer may only vote as themselves. Ignore any body customer_id
  // for a logged-in customer and bind the vote to the authenticated actor —
  // otherwise the "already voted" dedupe (keyed on customer_id) and the vote
  // record could both be forged under another member's id.
  const effectiveCustomerId = actingCustomer

  // Get proposal
  const { data: [proposal] } = await query.graph({
    entity: "garden_proposal",
    fields: ["id", "garden_id", "status", "voting_end"],
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

  // Check if already voted. The answer for the ordinary case only: two
  // concurrent requests both pass this read, and the unique index under
  // `castBallot` is what refuses the second ballot.
  const { data: existingVotes } = await query.graph({
    entity: "garden_vote",
    fields: ["id"],
    filters: { proposal_id: id, customer_id: effectiveCustomerId },
  })

  if (existingVotes.length > 0) {
    return alreadyVoted(res)
  }

  // Get membership for voting power
  //
  // SEC: the membership supplies the voting power, so it must be the caller's
  // own, active, and in *this proposal's* garden. Before, only the owner was
  // checked: a customer could vote on garden A's proposal with the labour and
  // investment balances of their membership in garden B (a probe wrote
  // voting_power 526 for a stranger to A), and a caller with no membership at
  // all voted at base power 1. Every one of those is refused the same way, so
  // the response says nothing about which memberships exist.
  if (typeof membership_id !== "string" || !membership_id) {
    return forbidden(res)
  }
  const { data: [membership] } = await query.graph({
    entity: "garden_membership",
    fields: ["id", "customer_id", "garden_id", "status", "voting_power", "volunteer_hours_balance", "investment_balance", "roles"],
    filters: { id: membership_id },
  })

  if (
    !membership ||
    membership.customer_id !== actingCustomer ||
    membership.garden_id !== proposal.garden_id ||
    membership.status !== "active"
  ) {
    return forbidden(res)
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
    labor_hours: (membership.volunteer_hours_balance as number) || 0,
    investment_amount: (membership.investment_balance as number) || 0,
    role_bonus: 0,
    weights: gardenSettings?.voting_weights || null,
  })

  // The ballot and its tally increment, in one transaction (`castBallot`).
  // The tally used to be written as absolute values computed from the
  // proposal read above, so concurrent votes overwrote each other's counts.
  const voteRecord = await governanceService.castBallot({
    proposal_id: id,
    garden_id: proposal.garden_id as string,
    customer_id: effectiveCustomerId,
    membership_id: membership.id as string,
    vote,
    voting_power,
    power_basis: {
      base: 1,
      labor_hours: (membership.volunteer_hours_balance as number) || 0,
      investment: (membership.investment_balance as number) || 0,
    },
    comment: typeof comment === "string" ? comment : null,
    comment_visibility: visibility,
    is_delegated: false,
    is_final: true,
    voted_at: new Date(),
  })

  if (!voteRecord) {
    return alreadyVoted(res)
  }

  res.status(201).json({ vote: voteRecord })
}
