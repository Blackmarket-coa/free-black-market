"use server"

import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

/**
 * Buyer-facing ticket data for event listings, backed by the ticket-booking
 * module's store routes:
 *
 * - GET /store/ticket-products/:product_id/availability
 * - GET /store/ticket-products/:product_id/seats?date=YYYY-MM-DD
 *
 * Both fetchers resolve to `null` on any failure (including a product with
 * no linked ticket product) so the product detail page degrades gracefully
 * instead of erroring. Seat/availability data is purchase-sensitive, so both
 * are fetched uncached.
 */

export type TicketRowTypeAvailability = {
  row_type: string
  total_seats: number
  available_seats: number
  sold_out: boolean
}

export type TicketDateAvailability = {
  date: string
  row_types: TicketRowTypeAvailability[]
  sold_out: boolean
}

export type TicketAvailability = {
  venue_name: string | null
  dates: TicketDateAvailability[]
}

export type TicketSeat = {
  number: string
  is_purchased: boolean
  variant_id: string | null
}

export type TicketSeatMapRow = {
  row_number: string
  row_type: string
  /** Required in ticket line-item metadata (create-ticket-purchases). */
  venue_row_id: string
  seats: TicketSeat[]
}

export type TicketSeatMap = {
  date: string
  seat_map: TicketSeatMapRow[]
}

type AvailabilityResponse = {
  ticket_product?: { venue?: { name?: string | null } | null } | null
  availability?: TicketDateAvailability[]
}

type SeatMapResponse = {
  date: string
  seat_map?: TicketSeatMapRow[]
}

/**
 * Fetch show dates + per-row-type seat availability for a product's linked
 * ticket product. Returns null when the product has no ticket product or the
 * fetch fails, so callers can simply hide the ticket panel.
 */
export const getTicketAvailability = async (
  productId: string
): Promise<TicketAvailability | null> => {
  if (!productId) return null

  const headers = {
    ...(await getAuthHeaders()),
  }

  try {
    const res = await medusaFetch<AvailabilityResponse>(
      `/store/ticket-products/${productId}/availability`,
      {
        method: "GET",
        headers,
        cache: "no-cache",
      }
    )

    if (!Array.isArray(res?.availability)) return null

    return {
      venue_name: res.ticket_product?.venue?.name ?? null,
      dates: res.availability,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the per-seat map for one show date. Purchased seats come back with
 * `is_purchased: true`; each row carries the `venue_row_id` the cart line
 * item's metadata must reference. Returns null on any failure.
 */
export const getTicketSeatMap = async (
  productId: string,
  date: string
): Promise<TicketSeatMap | null> => {
  if (!productId || !date) return null

  const headers = {
    ...(await getAuthHeaders()),
  }

  try {
    const res = await medusaFetch<SeatMapResponse>(
      `/store/ticket-products/${productId}/seats`,
      {
        method: "GET",
        query: { date },
        headers,
        cache: "no-cache",
      }
    )

    if (!Array.isArray(res?.seat_map)) return null

    return { date: res.date, seat_map: res.seat_map }
  } catch {
    return null
  }
}
