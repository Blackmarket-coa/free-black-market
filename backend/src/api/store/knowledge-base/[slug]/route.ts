import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { KNOWLEDGE_BASE_MODULE } from "../../../../modules/knowledge-base"
import type KnowledgeBaseService from "../../../../modules/knowledge-base/service"

/**
 * GET /store/knowledge-base/:slug
 * Full article (§14) with materials, steps, and related products.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = String(req.params.slug)
  const kb = req.scope.resolve<KnowledgeBaseService>(KNOWLEDGE_BASE_MODULE)

  const [article] = await kb.listKbArticles({ slug })
  if (!article) {
    return res
      .status(404)
      .json({ message: `Article "${slug}" not found`, type: "not_found" })
  }

  return res.status(200).json({ article })
}
