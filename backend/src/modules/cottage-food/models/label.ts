import { model } from "@medusajs/framework/utils"

/**
 * The "Big 9" major food allergens the FASTER Act requires be declared
 * (sesame joined the original eight in 2023).
 */
export const MAJOR_ALLERGENS = [
  "milk",
  "eggs",
  "fish",
  "crustacean_shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soybeans",
  "sesame",
] as const
export type MajorAllergen = (typeof MAJOR_ALLERGENS)[number]

/** Display names for the label block and the buyer-facing chips. */
export const ALLERGEN_LABELS: Record<MajorAllergen, string> = {
  milk: "Milk",
  eggs: "Eggs",
  fish: "Fish",
  crustacean_shellfish: "Crustacean shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  wheat: "Wheat",
  soybeans: "Soybeans",
  sesame: "Sesame",
}

/**
 * Cottage Food Label — the label content for one product.
 *
 * The producer/disclosure lines are *snapshotted* off the profile at
 * generation time rather than joined live. A label that was printed and stuck
 * to a jar last month should keep reading the way it read when it was printed,
 * even after the seller renews a permit or moves; re-rendering history to
 * match current profile state would misrepresent what is physically on the
 * shelf.
 */
const CottageFoodLabel = model.define("cottage_food_label", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  // Optional links out to whatever this label describes. Both nullable: a
  // seller may label something they haven't listed for sale yet.
  product_id: model.text().nullable(),
  botanical_formula_id: model.text().nullable(),

  product_name: model.text(),
  /** Free text — units vary ("12 oz", "340 g", "6 count"). */
  net_weight_text: model.text().nullable(),

  /**
   * Ordered array of `{ name, note? }`. Order is meaningful: standard labeling
   * practice lists ingredients in descending order by weight, so the seller's
   * arrangement is preserved exactly as entered.
   */
  ingredients: model.json().nullable(),

  /** Subset of MAJOR_ALLERGENS. */
  allergens: model.json().nullable(),
  /** Free text for "made in a kitchen that also handles..." style warnings. */
  allergen_cross_contact_note: model.text().nullable(),

  // ---- Snapshot of profile fields at generation time ----
  disclosure_text_snapshot: model.text().nullable(),
  business_name_snapshot: model.text().nullable(),
  address_snapshot: model.text().nullable(),
  permit_number_snapshot: model.text().nullable(),

  /**
   * The seller confirming they've read the composed label. FBM never marks a
   * label "approved" — only the seller can say it says what their jurisdiction
   * requires.
   */
  seller_reviewed_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id"], name: "IDX_cottage_food_label_seller_id" },
  { on: ["product_id"], name: "IDX_cottage_food_label_product_id" },
])

export default CottageFoodLabel
