import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { actingCustomerId } from "../../../shared/actor-scope"

const GOVERNANCE_MODULE = "governanceModuleService"

interface GovernanceServiceType {
  createGardenProposals: (data: Record<string, unknown>) => Promise<{ id: string }>
}

const listProposalsQuerySchema = z.object({
  garden_id: z.string().optional(),
  status: z.string().optional(),
  proposal_type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * GET /store/proposals
 * 
 * List governance proposals
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const parsedQuery = listProposalsQuerySchema.safeParse(req.query)
  if (!parsedQuery.success) {
    return res.status(400).json({
      error: "Invalid proposal query parameters",
      details: parsedQuery.error.flatten(),
    })
  }

  const { garden_id, status, proposal_type, limit, offset } = parsedQuery.data
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const filters: Record<string, unknown> = {}
  if (garden_id) filters.garden_id = garden_id
  if (status) filters.status = status
  if (proposal_type) filters.proposal_type = proposal_type

  const { data: proposals, metadata } = await query.graph({
    entity: "garden_proposal",
    fields: [
      "id",
      "garden_id",
      "title",
      "summary",
      "proposal_type",
      "proposed_by_id",
      "voting_start",
      "voting_end",
      "status",
      "votes_for",
      "votes_against",
      "votes_abstain",
      "unique_voters",
      "quorum_required",
      "approval_threshold",
    ],
    filters,
    pagination: {
      take: limit,
      skip: offset,
      order: {
        created_at: "DESC",
      },
    },
  })

  res.json({
    proposals,
    count: metadata?.count || proposals.length,
    limit,
    offset,
  })
}

/**
 * POST /store/proposals
 * 
 * Create a new proposal
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const governanceService = req.scope.resolve(GOVERNANCE_MODULE) as GovernanceServiceType

  const {
    garden_id,
    title,
    description,
    summary,
    proposal_type,
    proposed_by_id,
    voting_start,
    voting_end,
    quorum_required,
    approval_threshold,
    budget_request,
    policy_changes,
    attachment_urls,
  } = req.body as Record<string, unknown>

  // SEC: bind the proposal's author to the authenticated customer so a
  // logged-in customer cannot create a proposal as someone else. Non-customer
  // actors (seller/driver) fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveProposedById = (actingCustomer ?? proposed_by_id) as string

  const proposal = await governanceService.createGardenProposals({
    garden_id,
    title,
    description,
    summary,
    proposal_type: (proposal_type as string) || "other",
    proposed_by_id: effectiveProposedById,
    voting_start: voting_start ? new Date(voting_start as string) : new Date(),
    voting_end: new Date(voting_end as string),
    quorum_required: (quorum_required as number) || 50,
    approval_threshold: (approval_threshold as number) || 51,
    status: voting_start ? "active" : "draft",
    votes_for: 0,
    votes_against: 0,
    votes_abstain: 0,
    total_voting_power: 0,
    unique_voters: 0,
    budget_request,
    policy_changes,
    attachment_urls,
    discussion_enabled: true,
  })

  res.status(201).json({ proposal })
}
