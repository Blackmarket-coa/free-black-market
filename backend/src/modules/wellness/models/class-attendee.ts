import { model } from "@medusajs/framework/utils"

/**
 * Class Attendee — a registration for a {@link ClassEvent}. Created when a
 * ticket is purchased (linked to `order_id` by the wellness order subscriber)
 * or added manually by the practitioner.
 *
 * SCOPING: carries `seller_id` — attendee contact data must never cross vendor
 * boundaries. Every query filters by the authenticated seller.
 */
export type AttendeeStatus =
  | "registered"
  | "waitlisted"
  | "attended"
  | "no_show"
  | "cancelled"

const ClassAttendee = model.define("wellness_class_attendee", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  class_event_id: model.text(),

  customer_id: model.text().nullable(),
  customer_email: model.text(),
  customer_name: model.text().nullable(),

  order_id: model.text().nullable(),

  // "registered" | "waitlisted" | "attended" | "no_show" | "cancelled"
  status: model.text().default("registered"),

  // True when the seat was claimed with a membership credit rather than paid.
  used_membership_credit: model.boolean().default(false),
  checked_in_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["class_event_id"], name: "IDX_wellness_class_attendee_class_event_id" },
    { on: ["seller_id"], name: "IDX_wellness_class_attendee_seller_id" },
    { on: ["order_id"], name: "IDX_wellness_class_attendee_order_id" },
  ])

export default ClassAttendee
