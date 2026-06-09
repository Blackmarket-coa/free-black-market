import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { KNOWLEDGE_BASE_MODULE } from "../../../../modules/knowledge-base"
import type KnowledgeBaseService from "../../../../modules/knowledge-base/service"

const contributionSchema = z.object({
  title: z.string().min(3),
  type: z.enum(["DIY", "CONTAINER_GARDENING", "SUBSTITUTION"]).default("DIY"),
  summary: z.string().min(1),
  body: z.string().min(1),
  category: z.string().optional(),
  difficulty: z.string().optional(),
  climate_zone: z.string().optional(),
  space: z.string().optional(),
  materials: z.array(z.string()).optional(),
  steps: z.array(z.string()).optional(),
})

/**
 * POST /store/knowledge-base/contributions
 * Community Contributions (§14): an authenticated customer submits a
 * tutorial/guide/method for moderation.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = contributionSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid contribution", issues: parsed.error.issues })
  }
  const { title, type, ...payload } = parsed.data

  const kb = req.scope.resolve<KnowledgeBaseService>(KNOWLEDGE_BASE_MODULE)
  const contribution = await kb.submitContribution({
    submitter_id: customerId,
    submitter_type: "CUSTOMER",
    title,
    type,
    payload,
  })

  return res.status(201).json({
    contribution: {
      id: contribution.id,
      status: contribution.status,
      title: contribution.title,
    },
  })
}
