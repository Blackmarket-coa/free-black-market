import { model } from "@medusajs/framework/utils"

export enum KbArticleType {
  DIY = "DIY",
  CONTAINER_GARDENING = "CONTAINER_GARDENING",
  SUBSTITUTION = "SUBSTITUTION",
}

export enum KbArticleStatus {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
}

/**
 * A Product Knowledge Base article (§14): a DIY recipe, a container-gardening
 * guide, or a make-vs-buy / substitution guide. Seeded from the in-code catalog
 * (`catalog.ts`) and extended by approved community contributions.
 */
const KbArticle = model
  .define("kb_article", {
    id: model.id().primaryKey(),
    slug: model.text().unique(),
    title: model.text().searchable(),
    type: model
      .enum(Object.values(KbArticleType))
      .default(KbArticleType.DIY),
    summary: model.text(),
    body: model.text(),

    category: model.text().nullable(),
    difficulty: model.text().default("Beginner"),
    // Container-gardening facets.
    climate_zone: model.text().nullable(),
    space: model.text().nullable(),

    materials: model.json().nullable(),
    steps: model.json().nullable(),
    related_product_ids: model.json().nullable(),

    author_id: model.text().nullable(),
    contributed_by_community: model.boolean().default(false),
    status: model
      .enum(Object.values(KbArticleStatus))
      .default(KbArticleStatus.PUBLISHED),
    upvotes: model.number().default(0),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["slug"], name: "IDX_kb_article_slug" },
    { on: ["type"], name: "IDX_kb_article_type" },
    { on: ["category"], name: "IDX_kb_article_category" },
    { on: ["status"], name: "IDX_kb_article_status" },
  ])

export default KbArticle
