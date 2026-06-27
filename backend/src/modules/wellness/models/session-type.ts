import { model } from "@medusajs/framework/utils"

/**
 * Session Type — the practitioner's 1:1 service menu (Reiki, energy work,
 * readings, coaching, breathwork, sound healing, …).
 *
 * This is the *catalog* entry only. The actual bookable appointments reuse the
 * generic `booking` module: on create/update a `product_booking_config` is
 * upserted for `product_id` so the existing slot engine + `vendor_availability`
 * cover scheduling. We never re-implement slot math here.
 */
export type SessionLocationType = "video" | "in_person" | "phone" | "either"

const SessionType = model.define("wellness_session_type", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  // Linked Medusa product (the bookable listing on FBM). Nullable until created.
  product_id: model.text().nullable(),

  name: model.text(),
  description: model.text().nullable(),

  duration_minutes: model.number().default(60),
  buffer_minutes: model.number().default(0),

  // Price in the smallest currency unit (cents). Nullable for "contact me".
  price_amount: model.number().nullable(),
  currency_code: model.text().nullable(),

  // UI accent on the calendar.
  color: model.text().nullable(),

  // "video" | "in_person" | "phone" | "either"
  location_type: model.text().default("video"),

  // Intake form bound to this session type (template id), if any.
  intake_form_id: model.text().nullable(),
  // Prep instructions DM'd to the client on booking.
  prep_instructions: model.text().nullable(),

  // Optional soft weekly capacity limit.
  max_per_week: model.number().nullable(),

  // Surface in the connect.js embedded storefront.
  is_embeddable: model.boolean().default(true),
  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_wellness_session_type_seller_id" },
    { on: ["product_id"], name: "IDX_wellness_session_type_product_id" },
  ])

export default SessionType
