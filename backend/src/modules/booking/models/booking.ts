import { model } from "@medusajs/framework/utils"

/**
 * Booking status lifecycle:
 *   pending   — requested by a customer, not yet accepted/paid
 *   confirmed — accepted by the vendor (or auto-confirmed on payment)
 *   cancelled — cancelled by either party
 *   completed — the appointment happened
 *   no_show   — customer did not attend
 */
export enum BookingStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
  NO_SHOW = "no_show",
}

/**
 * Booking
 *
 * A single appointment against a bookable product. `starts_at`/`ends_at` are
 * absolute instants (UTC). `order_id` links the booking to the order that paid
 * for it (best-effort, set when checkout completes); `matrix_room_id` links to
 * a Blackout chat room when one is created.
 */
const Booking = model.define("booking", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  product_id: model.text(),
  variant_id: model.text().nullable(),

  // Set once the booking is paid/linked to an order and customer.
  order_id: model.text().nullable(),
  customer_id: model.text().nullable(),

  // Captured from the embed form so the vendor can reach the booker even
  // before an account/order exists.
  customer_email: model.text(),
  customer_name: model.text().nullable(),

  starts_at: model.dateTime(),
  ends_at: model.dateTime(),

  status: model.enum(Object.values(BookingStatus)).default(BookingStatus.PENDING),

  notes: model.text().nullable(),
  matrix_room_id: model.text().nullable(),
})
  .indexes([
    { on: ["seller_id", "starts_at"], name: "IDX_booking_seller_starts_at" },
    { on: ["product_id", "starts_at"], name: "IDX_booking_product_starts_at" },
    { on: ["order_id"], name: "IDX_booking_order_id" },
  ])

export default Booking
