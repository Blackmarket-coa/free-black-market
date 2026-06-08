import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { KNOWLEDGE_BASE_MODULE } from "../modules/knowledge-base"
import { KB_SEED_ARTICLES } from "../modules/knowledge-base/catalog"

/**
 * Seed the Knowledge Base (§14) from the in-code catalog. Idempotent: upserts
 * by slug. Mirrors seed-playbooks.ts.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-knowledge-base.ts
 */
export default async function seedKnowledgeBase({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const kb: any = container.resolve(KNOWLEDGE_BASE_MODULE)

  logger.info("[seed-knowledge-base] starting")

  let upserted = 0
  for (const a of KB_SEED_ARTICLES) {
    const [existing] = await kb.listKbArticles({ slug: a.slug })
    const payload = {
      slug: a.slug,
      title: a.title,
      type: a.type,
      summary: a.summary,
      body: a.body,
      category: a.category,
      difficulty: a.difficulty,
      climate_zone: a.climate_zone ?? null,
      space: a.space ?? null,
      materials: a.materials,
      steps: a.steps,
      contributed_by_community: false,
      status: "PUBLISHED",
    }
    if (existing) {
      await kb.updateKbArticles({ id: existing.id, ...payload })
    } else {
      await kb.createKbArticles(payload)
    }
    upserted++
  }

  logger.info(`[seed-knowledge-base] upserted ${upserted} articles`)
  logger.info("[seed-knowledge-base] done")
}
