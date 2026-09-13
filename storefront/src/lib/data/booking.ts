"use server"

import { cookies as nextCookies } from "next/headers"
import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

const BOOKING_COOKIE = "_fbm_booking"
// Marker so we don't re-POST on every cart fetch.
const STAMPED_COOKIE_PREFIX = "_fbm_booking_applied_"

/**
 * If the visitor has a `_fbm_booking` cookie (set by the storefront middleware
 * on `?booking_id=`), POST it to the backend so the cart carries the booking
 * through to its order.
 *
 * This is the storefront half of D9-6. `GET /store/embed/bookings` returns a
 * checkout URL with `?booking_id=` on it, and
 * `subscribers/link-booking-on-order-placed` reads that id off the order to
 * confirm the booking and email the customer — but nothing ever moved it from
 * the URL onto the cart, so the subscriber could not fire. No booking was
 * linked, none confirmed, no email sent.
 *
 * Deliberately the same shape as `applyAttributionToCart`, called from the same
 * place in `retrieveCart`, and idempotent for the same reason: the cart loader
 * runs on every cart fetch.
 *
 * Best-effort. The backend validates the id and refuses an unknown, cancelled
 * or already-purchased booking, and a refusal must not block checkout — the
 * customer can still buy, they simply do not get the booking linked, which is
 * the same position they were in before this existed.
 */
export async function applyBookingToCart(cartId: string): Promise<void> {
  if (!cartId) return

  let cookieStore: Awaited<ReturnType<typeof nextCookies>>
  try {
    cookieStore = await nextCookies()
  } catch {
    return
  }

  const bookingId = cookieStore.get(BOOKING_COOKIE)?.value
  if (!bookingId) return

  const stampKey = `${STAMPED_COOKIE_PREFIX}${cartId}`
  if (cookieStore.get(stampKey)?.value === bookingId) return

  const headers = {
    ...((await getAuthHeaders()) ?? {}),
  }

  try {
    await medusaFetch(`/store/carts/${cartId}/booking`, {
      method: "POST",
      headers,
      body: JSON.stringify({ booking_id: bookingId }),
    } as any)

    cookieStore.set(stampKey, bookingId, {
      maxAge: 60 * 60 * 24,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
  } catch {
    // Never block cart load on a booking that could not be attached.
  }
}
