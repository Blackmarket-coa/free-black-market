import { model } from "@medusajs/framework/utils"

/**
 * Intake Response — a client's submitted {@link IntakeForm}. May contain health
 * data; SCOPED to the owning seller and never exposed cross-vendor.
 */
const IntakeResponse = model.define("wellness_intake_response", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  intake_form_id: model.text(),

  client_profile_id: model.text().nullable(),
  booking_id: model.text().nullable(),
  class_attendee_id: model.text().nullable(),

  // Map of { [field.key]: answer }
  answers: model.json(),
  submitted_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["intake_form_id"], name: "IDX_wellness_intake_response_form_id" },
    { on: ["seller_id"], name: "IDX_wellness_intake_response_seller_id" },
    { on: ["booking_id"], name: "IDX_wellness_intake_response_booking_id" },
  ])

export default IntakeResponse
