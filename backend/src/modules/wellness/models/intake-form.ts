import { model } from "@medusajs/framework/utils"

/**
 * Intake Form — a reusable form template. `fields` is an ordered array of
 * field descriptors:
 *   { key, label, type: "short"|"long"|"yes_no"|"dropdown"|"date", required, options? }
 * The form link is embedded in the booking-confirmation Blackout DM.
 */
export type IntakeFieldType = "short" | "long" | "yes_no" | "dropdown" | "date"

export interface IntakeFieldDef {
  key: string
  label: string
  type: IntakeFieldType
  required?: boolean
  options?: string[]
}

const IntakeForm = model.define("wellness_intake_form", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  title: model.text(),
  description: model.text().nullable(),

  // Array<IntakeFieldDef>
  fields: model.json(),

  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_wellness_intake_form_seller_id" },
  ])

export default IntakeForm
