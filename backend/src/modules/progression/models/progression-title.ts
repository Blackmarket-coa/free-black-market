import { model } from "@medusajs/framework/utils"
import { Stance } from "../stance"

/**
 * Progression Title
 *
 * Seedable catalog of earnable titles (Village Farmer, Market Trader, Community
 * Investor, Coalition Steward…). A title is granted when a customer's level in
 * the matching role track reaches `min_level`. Mirrors the shape of
 * impact-metrics' `DEFAULT_BUYER_BADGES` seed pattern.
 */
const ProgressionTitle = model.define("progression_title", {
  id: model.id().primaryKey(),

  // Stable slug, unique across the catalog.
  slug: model.text().unique(),

  // The role track this title belongs to.
  role: model.enum(Object.values(Stance)),

  name: model.text(),
  description: model.text(),

  // Level in the matching role track required to earn this title.
  min_level: model.number().default(1),

  icon: model.text().nullable(),
  color: model.text().nullable(),

  display_order: model.number().default(0),
  active: model.boolean().default(true),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["slug"], name: "IDX_progression_title_slug" },
    { on: ["role"], name: "IDX_progression_title_role" },
  ])

export default ProgressionTitle
