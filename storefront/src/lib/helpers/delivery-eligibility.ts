/**
 * The delivery-zone check's answer codes that mean "we could not tell", as
 * opposed to the backend's "no" (`DELIVERY_NOT_AVAILABLE`,
 * `DELIVERY_ZONES_UNAVAILABLE`). The delivery step reports both and acts on
 * neither: an unknown answer is no reason to take the buyer off Delivery.
 *
 * Kept out of lib/data/delivery.ts because a "use server" module may export
 * only async functions.
 */

/** The check could not be made (the request failed or was refused). */
export const DELIVERY_CHECK_FAILED = "DELIVERY_CHECK_FAILED"

/** The postal code could not be placed on a map. */
export const DELIVERY_COORDINATES_UNAVAILABLE = "DELIVERY_COORDINATES_UNAVAILABLE"

/** True when the answer is "we could not check", not "delivery is not available". */
export const isFailedDeliveryCheck = (answer: { code?: string } | null | undefined): boolean =>
  answer?.code === DELIVERY_CHECK_FAILED || answer?.code === DELIVERY_COORDINATES_UNAVAILABLE
