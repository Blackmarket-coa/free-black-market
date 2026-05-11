import { model } from "@medusajs/framework/utils"

/**
 * Playbook
 *
 * Registry of the ten cooperative-economic shapes a vendor can pick at
 * setup. Recipe data is the source of truth in
 * `backend/src/modules/playbook/recipes/*.ts`; this table is the
 * denormalized, query-friendly view seeded from that catalog.
 *
 * See `docs/PLAYBOOK_SYSTEM.md`.
 */
const Playbook = model.define("playbook", {
  id: model.id().primaryKey(),

  /** Recipe identifier: stall | atelier | grove | workshop | commons | cycle | kitchen | harvest | hub | service. */
  recipe_id: model.text().unique(),

  /** Display copy. */
  display_name: model.text(),
  social_form: model.text(),
  storefront_blurb_default: model.text(),

  /** Commission rate as a fraction (e.g. 0.03 for 3 %). */
  commission_rate: model.float().default(0.03),

  /** Whether vendors on this playbook may offer sliding-scale tiered pricing. */
  allow_sliding_scale: model.boolean().default(false),

  /**
   * "true" | "false" | "opt_in" — stored as text since the recipe shape
   * is tri-state. Falsey only for closed-loop-incompatible recipes, of
   * which there are none in v1.
   */
  allow_credits_payout: model.text().default("true"),

  /** solo | flat | sociocratic | multi_stakeholder | federation. */
  member_model: model.text(),

  /** Allowed listing-type IDs (workflow validates on product.created). */
  allowed_listing_types: model.json(),

  /** Default VendorFeatures keys (vendor-panel reads these on seller creation). */
  default_features: model.json(),

  /** Whether the playbook is currently selectable by new vendors. */
  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["recipe_id"], name: "IDX_playbook_recipe_id" },
  { on: ["is_active"], name: "IDX_playbook_is_active" },
])

export default Playbook
