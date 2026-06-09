import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { KNOWLEDGE_BASE_MODULE } from "../../../modules/knowledge-base"
import type KnowledgeBaseService from "../../../modules/knowledge-base/service"
import { filterArticles } from "../../../modules/knowledge-base/catalog"
import { KbArticleStatus } from "../../../modules/knowledge-base/models/kb-article"

/**
 * GET /store/knowledge-base
 * DIY Library (§14): list published articles, filterable by type, category,
 * difficulty, climate_zone, space, and free-text q.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const kb = req.scope.resolve<KnowledgeBaseService>(KNOWLEDGE_BASE_MODULE)
  const {
    type,
    category,
    difficulty,
    climate_zone,
    space,
    q,
    limit = "50",
    offset = "0",
  } = req.query as Record<string, string>

  const all = await kb.listKbArticles(
    { status: KbArticleStatus.PUBLISHED },
    { take: 1000, order: { title: "ASC" } }
  )

  // Reuse the same pure filter the catalog defines (works on DB rows).
  const filtered = filterArticles(all as any[], {
    type,
    category,
    difficulty,
    climate_zone,
    space,
    q,
  })

  const start = parseInt(offset, 10) || 0
  const take = Math.min(parseInt(limit, 10) || 50, 100)
  const page = filtered.slice(start, start + take)

  return res.status(200).json({
    count: filtered.length,
    articles: page.map((a: any) => ({
      slug: a.slug,
      title: a.title,
      type: a.type,
      summary: a.summary,
      category: a.category,
      difficulty: a.difficulty,
      climate_zone: a.climate_zone,
      space: a.space,
      contributed_by_community: a.contributed_by_community,
      upvotes: a.upvotes,
    })),
  })
}
