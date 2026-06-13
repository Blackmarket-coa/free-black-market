import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/collective/bargaining-groups")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../modules/bargaining"
import BargainingModuleService from "../../../../modules/bargaining/service"

const createGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  common_requirements: z.record(z.string(), z.unknown()).optional(),
  delivery_specs: z.record(z.string(), z.unknown()).optional(),
  payment_terms: z.record(z.string(), z.unknown()).optional(),
  quality_standards: z.record(z.string(), z.unknown()).optional(),
  voting_rule: z
    .enum([
      "ONE_MEMBER_ONE_VOTE",
      "WEIGHTED_BY_QUANTITY",
      "SUPERMAJORITY",
      "SIMPLE_MAJORITY",
    ])
    .optional(),
  approval_threshold: z.number().min(1).max(100).optional(),
  min_members: z.number().int().min(2).optional(),
  max_members: z.number().int().positive().optional(),
  currency_code: z.string().optional(),
  demand_post_id: z.string().optional(),
  buyer_network_id: z.string().optional(),
  negotiation_deadline: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const listGroupsSchema = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  my_groups: z.coerce.boolean().optional(),
})

// GET /store/collective/bargaining-groups
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listGroupsSchema.parse(req.query)
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    if (query.my_groups) {
      const customerId = (req as any).auth_context?.actor_id
      if (!customerId) {
        return res.status(401).json({ error: "Unauthorized" })
      }
      const groups = await bargainingService.getMyGroups(customerId)
      return res.json({ bargaining_groups: groups })
    }

    const groups = await bargainingService.getOpenGroups({
      category: query.category,
      limit: query.limit,
      offset: query.offset,
    })

    res.json({
      bargaining_groups: groups,
      count: groups.length,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error("[GET /store/collective/bargaining-groups] Error:", error.message)
    res.status(500).json({ error: "Failed to retrieve bargaining groups" })
  }
}

// POST /store/collective/bargaining-groups
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = createGroupSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const group = await bargainingService.createGroup({
      ...body,
      organizer_id: customerId,
      organizer_type: "CUSTOMER",
      negotiation_deadline: body.negotiation_deadline
        ? new Date(body.negotiation_deadline)
        : undefined,
    })

    res.status(201).json({ bargaining_group: group })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error("[POST /store/collective/bargaining-groups] Error:", error.message)
    res.status(400).json({ error: error.message })
  }
}
