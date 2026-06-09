import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { KNOWLEDGE_BASE_MODULE } from "../../../../../../modules/knowledge-base"
import type KnowledgeBaseService from "../../../../../../modules/knowledge-base/service"

const decideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
  slug: z.string().optional(),
  category: z.string().optional(),
  difficulty: z.string().optional(),
})

/**
 * POST /admin/knowledge-base/contributions/:id/decide
 * Moderate a community contribution (§14): approve (→ published article) or
 * reject. Admin-authed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const reviewerId = (req as any).auth_context?.actor_id || "admin"
  const id = String(req.params.id)

  const parsed = decideSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid decision", issues: parsed.error.issues })
  }

  const kb = req.scope.resolve<KnowledgeBaseService>(KNOWLEDGE_BASE_MODULE)

  try {
    if (parsed.data.decision === "APPROVE") {
      const article = await kb.approveContribution(id, reviewerId, {
        slug: parsed.data.slug,
        category: parsed.data.category,
        difficulty: parsed.data.difficulty,
      })
      return res
        .status(200)
        .json({ status: "APPROVED", article: { id: article.id, slug: article.slug } })
    }
    const contribution = await kb.rejectContribution(
      id,
      reviewerId,
      parsed.data.note
    )
    return res.status(200).json({ status: "REJECTED", contribution })
  } catch (e) {
    return res.status(404).json({ message: (e as Error).message, type: "not_found" })
  }
}
