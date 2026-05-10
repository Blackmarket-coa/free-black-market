import { model } from "@medusajs/framework/utils"

/**
 * Share Box Template
 *
 * A coordinator-defined recurring CSA-style box. The template declares a
 * set of slots (e.g. "1 leafy green", "1 root vegetable", "2 fruits") that
 * the scheduler resolves against the products of an open order cycle when
 * generating each member's box for that cycle.
 *
 * Slots are stored as JSON to keep the data model approachable without a
 * dedicated slot table; the slot shape is the contract enforced by
 * service-side validation.
 *
 * Slot shape:
 *   {
 *     "key": "leafy_green",          // stable id within the template
 *     "label": "Leafy Green",
 *     "quantity": 1,                 // count of variants to fill this slot
 *     "candidate_variant_ids": [],   // optional whitelist; empty means
 *                                    // any variant in the cycle qualifies
 *     "tag": null                    // optional metadata tag for grouping
 *   }
 */
const ShareBoxTemplate = model.define("share_box_template", {
  id: model.id().primaryKey(),

  coordinator_seller_id: model.text(),

  name: model.text().searchable(),
  description: model.text().nullable(),

  // Total price for the box, in the cycle's currency minor unit (e.g. cents).
  // null = price computed from member-selected variants at allocation time.
  base_price: model.bigNumber().nullable(),
  currency_code: model.text().default("usd"),

  // Slot definitions. See header comment for shape.
  slots: model.json(),

  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
})
  .indexes([
    {
      name: "IDX_SBT_COORDINATOR",
      on: ["coordinator_seller_id"],
    },
    {
      name: "IDX_SBT_ACTIVE",
      on: ["is_active"],
    },
  ])

export default ShareBoxTemplate
