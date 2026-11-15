import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GOVERNANCE_MODULE } from "../../../../modules/governance"
import {
  actorIsAnyOf,
  forbidden,
} from "../../../../shared/community-read-access"

interface GovernanceServiceType {
  updateGardenProposals: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/proposals/:id
 * 
 * Get a proposal by ID
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: [proposal] } = await query.graph({
    entity: "garden_proposal",
    fields: [
      "id",
      "garden_id",
      "title",
      "description",
      "summary",
      "proposal_type",
      "proposed_by_id",
      "co_sponsors",
      "voting_start",
      "voting_end",
      "quorum_required",
      "approval_threshold",
      "status",
      "votes_for",
      "votes_against",
      "votes_abstain",
      "total_voting_power",
      "unique_voters",
      "eligible_voters",
      "eligible_voting_power",
      "result_calculated_at",
      "quorum_met",
      "approval_percentage",
      "implementation_notes",
      "implemented_at",
      "budget_request",
      "policy_changes",
      "attachment_urls",
      "discussion_enabled",
    ],
    filters: { id },
  })

  if (!proposal) {
    res.status(404).json({ message: "Proposal not found" })
    return
  }

  res.json({ proposal })
}

/** Statuses in which the author may still revise a proposal. */
const EDITABLE_STATUSES = new Set(["draft", "submitted"])

/**
 * What the author may change, mirroring what `POST /store/proposals` lets them
 * set. Unknown keys are stripped, so the tally (`votes_*`,
 * `total_voting_power`, `unique_voters`), the electorate snapshot
 * (`eligible_*`), the result (`quorum_met`, `approval_percentage`,
 * `result_calculated_at`), implementation and ledger fields, `garden_id` and
 * `proposed_by_id` cannot be written here. `status` may only move to
 * `submitted`, `active` (open voting, as creating with a `voting_start` does)
 * or `withdrawn`; `passed`, `rejected`, `tie`, `implemented` and `expired` are
 * the finalize workflow's to set.
 */
const updateProposalSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  summary: z.string().nullable().optional(),
  proposal_type: z
    .enum([
      "budget",
      "policy",
      "membership",
      "infrastructure",
      "governance",
      "allocation",
      "season_plan",
      "partnership",
      "other",
    ])
    .optional(),
  voting_start: z.coerce.date().optional(),
  voting_end: z.coerce.date().optional(),
  // Positive, as on create, where a falsy value falls back to the default.
  quorum_required: z.number().gt(0).max(100).optional(),
  approval_threshold: z.number().gt(0).max(100).optional(),
  budget_request: z.record(z.string(), z.unknown()).nullable().optional(),
  policy_changes: z.record(z.string(), z.unknown()).nullable().optional(),
  attachment_urls: z.array(z.string()).nullable().optional(),
  discussion_enabled: z.boolean().optional(),
  status: z.enum(["submitted", "active", "withdrawn"]).optional(),
})

/**
 * PUT /store/proposals/:id
 * 
 * Revise a proposal. Its author only, and only until voting opens: once a
 * proposal is `active` the text and thresholds being voted on are fixed. A
 * proposal that does not exist is refused the same way as someone else's.
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: [existing] } = await query.graph({
    entity: "garden_proposal",
    fields: ["id", "proposed_by_id", "status"],
    filters: { id },
  })

  if (
    !existing ||
    !actorIsAnyOf(req, existing.proposed_by_id as string | null | undefined)
  ) {
    return forbidden(res)
  }

  if (!EDITABLE_STATUSES.has(existing.status as string)) {
    res.status(409).json({
      message: "A proposal cannot be changed once voting has opened",
      current_status: existing.status,
    })
    return
  }

  const parsed = updateProposalSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: parsed.error.issues })
    return
  }

  const governanceService = req.scope.resolve(GOVERNANCE_MODULE) as GovernanceServiceType

  const proposal = await governanceService.updateGardenProposals({
    ...parsed.data,
    id,
  })

  res.json({ proposal })
}
