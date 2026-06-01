import { model } from "@medusajs/framework/utils"
import { Stance } from "../stance"

/**
 * XP Event
 *
 * Append-only ledger of every experience-point award (or clawback). Modelled
 * deliberately after hawala-ledger's `karma_event`: signed `amount`, a `reason`
 * slug, and a `source_module` / `source_id` audit trail back to the originating
 * record so XP can always be re-derived or reversed.
 *
 * This is the one genuinely-new fact the progression module owns — it exists
 * nowhere else in the system.
 */
const XpEvent = model.define("xp_event", {
  id: model.id().primaryKey(),

  customer_id: model.text(),

  // Which role track this XP credits.
  role: model.enum(Object.values(Stance)),

  // Signed XP delta. Negative for clawbacks (e.g. order canceled).
  amount: model.number(),

  // Slug describing why XP was awarded: order-placed, volunteer-verified,
  // campaign-backed, karma-accrued, verified, order-canceled, etc.
  reason: model.text(),

  // Audit trail back to the originating record.
  source_module: model.text().nullable(),
  source_id: model.text().nullable(),

  occurred_at: model.dateTime(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["customer_id"], name: "IDX_xp_event_customer_id" },
    { on: ["reason"], name: "IDX_xp_event_reason" },
    { on: ["source_module", "source_id"], name: "IDX_xp_event_source" },
  ])

export default XpEvent
