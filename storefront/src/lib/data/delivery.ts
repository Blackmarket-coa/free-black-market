"use server"

import { medusaFetch } from "../config"
import {
  DELIVERY_CHECK_FAILED,
  DELIVERY_COORDINATES_UNAVAILABLE,
} from "@/lib/helpers/delivery-eligibility"
import { getAuthHeaders } from "./cookies"

/**
 * Whether FBM's own delivery zones reach an address
 * (`POST /store/delivery-zones/check`), the advisory check the checkout's
 * delivery step shows beside the Delivery options.
 *
 * The browser used to call the backend itself with a bare `fetch`, which sends
 * no publishable key, and every `/store` route refuses that: 400 "Publishable
 * API key required" (measured by the checkout scout). So the check failed for
 * every buyer, and the step quietly switched them away from Delivery. It now
 * goes out from the server, through `medusaFetch`, which adds the key as the
 * storefront's other store calls do, and the buyer's token when they are
 * signed in. Until the backend stops requiring a login for this route (the
 * backend unit's change), a guest's check answers 401 and reads as a failed
 * check, which the step reports and does not act on.
 */

export type DeliveryEligibility = {
  available: boolean
  code?: string
  reason?: string
  suggestion?: string
  message?: string
  next_action?: string
  currently_open?: boolean
  zone?: { id: string; name: string; code: string }
  delivery?: {
    fee: number
    fee_formatted: string
    estimated_time: string
    distance_miles: number
    minimum_order: number
    minimum_order_formatted: string | null
  }
  service_hours?: Record<string, { open: string; close: string }>
  /**
   * Set by `checkDeliveryForPostalCode` when the backend placed the postal
   * code only approximately (its ZIP3 centroid, not the address): the answer
   * is then about a point that may be miles from the buyer.
   */
  approximate?: boolean
}

const checkFailed = (): DeliveryEligibility => ({
  available: false,
  code: DELIVERY_CHECK_FAILED,
  reason: "We couldn't check delivery to your address just now.",
  suggestion: "You can still choose a delivery option, or pick another way to receive your order.",
})

/**
 * The check for a point, as `POST /store/delivery-zones/check` answers it.
 * Never throws: a failure is answered as a failed check (`DELIVERY_CHECK_FAILED`).
 */
export async function checkDeliveryAt(point: {
  latitude: number
  longitude: number
  producer_id?: string
}): Promise<DeliveryEligibility> {
  const { latitude, longitude, producer_id } = point
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return checkFailed()
  }
  try {
    const answer = await medusaFetch<DeliveryEligibility>("/store/delivery-zones/check", {
      method: "POST",
      headers: { ...((await getAuthHeaders()) ?? {}) },
      body: { latitude, longitude, ...(producer_id ? { producer_id } : {}) },
      cache: "no-store",
    })
    return typeof answer?.available === "boolean" ? answer : checkFailed()
  } catch {
    return checkFailed()
  }
}

/**
 * The check for a postal code: the backend places it (`GET /store/geocode`,
 * the lookup the storefront's `/api/geocode` proxies) and the point is
 * checked. Never throws.
 */
export async function checkDeliveryForPostalCode(postalCode: string): Promise<DeliveryEligibility> {
  const code = typeof postalCode === "string" ? postalCode.trim() : ""
  if (code.length < 3) {
    return {
      available: false,
      code: DELIVERY_COORDINATES_UNAVAILABLE,
      reason: "We couldn't check delivery for this postal code.",
      suggestion: "Check the postal code in your address.",
    }
  }

  let point: { latitude?: unknown; longitude?: unknown; approximate?: unknown }
  try {
    point = await medusaFetch<typeof point>("/store/geocode", {
      method: "GET",
      query: { postal_code: code },
      next: { revalidate: 3600 },
    })
  } catch {
    return {
      available: false,
      code: DELIVERY_COORDINATES_UNAVAILABLE,
      reason: "We couldn't place your postal code on the map to check delivery.",
      suggestion: "You can still choose a delivery option, or pick another way to receive your order.",
    }
  }

  const latitude = Number(point?.latitude)
  const longitude = Number(point?.longitude)
  const answer = await checkDeliveryAt({ latitude, longitude })
  return point?.approximate === true ? { ...answer, approximate: true } : answer
}
