import { model } from "@medusajs/framework/utils"

/**
 * Persisted projection of the in-code startup-guide catalog (§12). Code
 * (`startup-guides/index.ts`) is the source of truth; this table is seeded from
 * it so guides can be linked/queried alongside other entities. Mirrors the
 * playbook registry pattern.
 */
const StartupGuide = model
  .define("startup_guide", {
    id: model.id().primaryKey(),
    guide_id: model.text().unique(),
    slug: model.text().unique(),
    title: model.text().searchable(),
    category: model.text(),
    summary: model.text(),
    estimated_startup_cost_cents: model.number().default(0),
    difficulty: model.text().default("Beginner"),
    required_equipment: model.json(),
    production_suggestions: model.json(),
    related_archetypes: model.json(),
    related_opportunity_key: model.text(),
    is_active: model.boolean().default(true),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["slug"], name: "IDX_startup_guide_slug" },
    { on: ["category"], name: "IDX_startup_guide_category" },
  ])

export default StartupGuide
