import { model } from "@medusajs/framework/utils"

/**
 * Class Event — a scheduled group class / workshop with a fixed date, time and
 * capacity (New Moon Sound Bath, breathwork circle, …). Ticketed via a linked
 * Medusa product; capacity is tracked here as a simple count (a solo
 * practitioner doesn't need assigned-seat ticketing).
 */
export type ClassStatus = "scheduled" | "open" | "full" | "cancelled" | "completed"
export type ClassLocationType = "video" | "in_person" | "hybrid"

const ClassEvent = model.define("wellness_class_event", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  product_id: model.text().nullable(),

  title: model.text(),
  description: model.text().nullable(),

  starts_at: model.dateTime(),
  ends_at: model.dateTime(),
  timezone: model.text().default("America/New_York"),

  capacity: model.number().default(0),
  seats_taken: model.number().default(0),
  waitlist_enabled: model.boolean().default(false),

  // Ticket price in the smallest currency unit (cents); null = free.
  price_amount: model.number().nullable(),
  currency_code: model.text().nullable(),
  early_bird_amount: model.number().nullable(),
  early_bird_until: model.dateTime().nullable(),

  // "video" | "in_person" | "hybrid"
  location_type: model.text().default("video"),
  // Address or meeting link — only surfaced to registered attendees.
  location_detail: model.text().nullable(),

  // "scheduled" | "open" | "full" | "cancelled" | "completed"
  status: model.text().default("scheduled"),

  // Recording shared with ticket holders after the event.
  recording_url: model.text().nullable(),

  // Blackout room for a virtual class, when provisioned.
  matrix_room_id: model.text().nullable(),

  is_embeddable: model.boolean().default(true),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id", "starts_at"], name: "IDX_wellness_class_event_seller_starts" },
    { on: ["product_id"], name: "IDX_wellness_class_event_product_id" },
  ])

export default ClassEvent
