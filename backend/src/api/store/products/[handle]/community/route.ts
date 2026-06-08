import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { KNOWLEDGE_BASE_MODULE } from "../../../../../modules/knowledge-base"
import type KnowledgeBaseService from "../../../../../modules/knowledge-base/service"
import { filterArticles } from "../../../../../modules/knowledge-base/catalog"
import { KbArticleStatus } from "../../../../../modules/knowledge-base/models/kb-article"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"

/**
 * GET /store/products/:handle/community
 * Community Product Page panel (§13): related coalitions, creator content
 * (knowledge-base tutorials), and a discussion link. Note: the discussion
 * threads themselves ("Dens") live in the Blackout repo and are surfaced via
 * the existing webhook contract — this returns the deep-link/placeholder, not
 * an FBM-hosted thread.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = String(req.params.handle)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve the product + its category.
  let productId: string | null = null
  let categories: string[] = []
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "categories.name"],
      filters: { handle },
      pagination: { take: 1 },
    })
    const product = (data || [])[0]
    productId = product?.id ?? null
    categories = (product?.categories ?? [])
      .map((c: any) => c?.name)
      .filter((n: unknown): n is string => typeof n === "string")
  } catch {
    productId = null
  }

  const primaryCategory = categories[0]

  // Related knowledge-base / creator content in the product's category.
  let creatorContent: Array<{ slug: string; title: string; type: string }> = []
  try {
    const kb = req.scope.resolve<KnowledgeBaseService>(KNOWLEDGE_BASE_MODULE)
    const published = await kb.listKbArticles(
      { status: KbArticleStatus.PUBLISHED },
      { take: 500 }
    )
    const matched = primaryCategory
      ? filterArticles(published as any[], { category: primaryCategory })
      : (published as any[]).slice(0, 6)
    creatorContent = matched.slice(0, 6).map((a: any) => ({
      slug: a.slug,
      title: a.title,
      type: a.type,
    }))
  } catch {
    creatorContent = []
  }

  // Related coalitions (best-effort, public storefronts).
  let coalitions: Array<{ id: string; name: string }> = []
  try {
    const coop: any = req.scope.resolve(COOPERATIVE_MODULE)
    const coops = await coop.listCooperatives(
      { public_storefront_enabled: true },
      { take: 6 }
    )
    coalitions = (coops as any[]).map((c) => ({ id: c.id, name: c.name }))
  } catch {
    coalitions = []
  }

  return res.status(200).json({
    product_handle: handle,
    product_id: productId,
    coalition_recommendations: coalitions,
    creator_content: creatorContent,
    // Dens discussion lives in Blackout; deep-link by product when available.
    discussion: {
      provider: "blackout-dens",
      // The Blackout app resolves this into the product's Den thread.
      deep_link: productId ? `blackout://dens/product/${productId}` : null,
    },
  })
}
