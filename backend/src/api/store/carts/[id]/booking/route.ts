import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BOOKING_MODULE } from "../../../../../modules/booking"
import { BookingStatus } from "../../../../../modules/booking/models/booking"
import type BookingService from "../../../../../modules/booking/service"

type Body = {
  booking_id?: string
}

/**
 * Stamp a booking id onto a cart, so the order that cart becomes can be linked
 * back to the booking (D9-6).
 *
 * ## The loop this closes
 *
 * `GET /store/embed/bookings` creates a booking and hands back a checkout URL
 * with `?booking_id=<id>` on it. `subscribers/link-booking-on-order-placed`
 * then reads `booking_id` from the order's metadata to confirm the booking and
 * email the customer. Nothing connected the two: the id existed only in a query
 * string, and the string appeared in exactly one place in the repository. So no
 * booking was ever linked, none was ever confirmed, and no customer ever got
 * the confirmation email — the subscriber could not fire.
 *
 * This is the missing hop, and it is deliberately the same shape as
 * `carts/[id]/attribution`: the storefront middleware puts the URL parameter
 * into a cookie, the cart loader POSTs it here, and the value lands on cart
 * metadata where checkout carries it to the order.
 *
 * ## Validation
 *
 * The id is checked against a real booking that is not cancelled, rather than
 * written through unread. `booking_id` is caller-supplied, and an unvalidated
 * one would let anyone stamp any booking onto their own cart and have the
 * subscriber confirm someone else's reservation on payment. Confirming a
 * booking is a state change with a physical consequence — a slot held, a
 * courier dispatched, a table kept — so it is checked here rather than trusted.
 *
 * A booking already tied to a different order is refused for the same reason:
 * it has been paid for once already.
 *
 * Idempotent: re-POSTing the same id is a no-op, because the cart loader calls
 * this on every cart fetch.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const body = (req.validatedBody || req.body || {}) as Body
  const bookingId = (body.booking_id || "").trim()
  if (!bookingId) {
    return res.status(400).json({ message: "booking_id is required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id },
  })
  const cart = carts?.[0]
  if (!cart) return res.status(404).json({ message: "Cart not found" })

  const existingMd = (cart.metadata || {}) as Record<string, unknown>
  if (existingMd.booking_id === bookingId) {
    return res.json({ cart_id: id, booking_id: bookingId, idempotent: true })
  }

  const bookingService = req.scope.resolve<BookingService>(BOOKING_MODULE)
  let booking: { id: string; status?: string; order_id?: string | null } | undefined
  try {
    const rows = await bookingService.listBookings({ id: bookingId }, { take: 1 })
    booking = rows?.[0]
  } catch {
    booking = undefined
  }

  if (!booking) {
    return res.status(404).json({ message: "Unknown booking_id" })
  }
  if (booking.status === BookingStatus.CANCELLED) {
    return res.status(409).json({ message: "That booking was cancelled" })
  }
  if (booking.order_id && booking.order_id !== null) {
    return res
      .status(409)
      .json({ message: "That booking already belongs to an order" })
  }

  const cartModule: any = req.scope.resolve(Modules.CART)
  await cartModule.updateCarts(id, {
    metadata: { ...existingMd, booking_id: bookingId },
  })

  return res.json({ cart_id: id, booking_id: bookingId })
}
