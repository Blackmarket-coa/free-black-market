/**
 * What the delivery step does with the delivery-zone check's answer
 * (`POST /store/delivery-zones/check`, through lib/data/delivery.ts).
 *
 * The check is FBM's own: nothing downstream enforces delivery zones, so a
 * buyer outside them can still buy a Delivery option. It is also approximate
 * unless the backend's spatial geocoder is on: a postal code is placed at its
 * ZIP3 centroid. So its "no" is a nudge, not a block:
 *
 * - `DELIVERY_NOT_AVAILABLE` (outside every zone): Pickup, else Shipping, is
 *   pre-selected once when either is offered, with the reason kept in view,
 *   and the buyer can switch back to Delivery.
 * - `DELIVERY_ZONES_UNAVAILABLE` (the store has no delivery zones at all):
 *   nothing is shown and nothing is pre-selected. The answer says "no" to
 *   every buyer about a feature that is not set up; it used to tell each of
 *   them "No delivery zones are currently configured".
 * - `DELIVERY_CHECK_FAILED`, `DELIVERY_COORDINATES_UNAVAILABLE` (we could not
 *   tell): reported, and acted on by nothing.
 *
 * Kept out of lib/data/delivery.ts because a "use server" module may export
 * only async functions. Pure TS with no imports.
 */

/** The check could not be made (the request failed or was refused). */
export const DELIVERY_CHECK_FAILED = "DELIVERY_CHECK_FAILED"

/** The postal code could not be placed on a map. */
export const DELIVERY_COORDINATES_UNAVAILABLE = "DELIVERY_COORDINATES_UNAVAILABLE"

/** The backend's definite "no": the address is outside every delivery zone. */
export const DELIVERY_NOT_AVAILABLE = "DELIVERY_NOT_AVAILABLE"

/** The store has no active delivery zone: the check has nothing to check against. */
export const DELIVERY_ZONES_UNAVAILABLE = "DELIVERY_ZONES_UNAVAILABLE"

type Answer = { available?: boolean; code?: string } | null | undefined

/** True when the answer is "we could not check", not "delivery is not available". */
export const isFailedDeliveryCheck = (answer: Answer): boolean =>
  answer?.code === DELIVERY_CHECK_FAILED || answer?.code === DELIVERY_COORDINATES_UNAVAILABLE

/** True for the backend's "outside every delivery zone", and for nothing else. */
export const isOutsideDeliveryZones = (answer: Answer): boolean =>
  answer?.available === false && answer.code === DELIVERY_NOT_AVAILABLE

/** False when there is nothing to tell the buyer: no answer, or a store with no delivery zones. */
export const deliveryAnswerIsShown = (answer: Answer): boolean =>
  !!answer && answer.code !== DELIVERY_ZONES_UNAVAILABLE

export type DeliveryAlternative = "pickup" | "shipping"

/**
 * Which answer the step last acted on, and where it moved the selection, if
 * it did. Each answer is acted on once: a buyer who switches back to Delivery
 * after the nudge is not moved again.
 */
export type DeliveryNudge = { answer: object | null; to: DeliveryAlternative | undefined }

export const NO_DELIVERY_NUDGE: DeliveryNudge = { answer: null, to: undefined }

/**
 * The nudge for an answer: the same `state` back when the answer was already
 * acted on (or there is none), else a new state naming the type to pre-select
 * instead of Delivery, if any. Only "outside every delivery zone" nudges, only
 * to a type the cart's sellers offer (Pickup before Shipping), and never away
 * from Pickup or Shipping the buyer already picked.
 */
export function deliveryNudgeFor(
  state: DeliveryNudge,
  answer: ({ available?: boolean; code?: string } & object) | null | undefined,
  offered: { pickup: boolean; shipping: boolean },
  picked: "delivery" | DeliveryAlternative | undefined
): DeliveryNudge {
  if (!answer || state.answer === answer) return state
  const movable = picked === undefined || picked === "delivery"
  const to: DeliveryAlternative | undefined =
    isOutsideDeliveryZones(answer) && movable
      ? offered.pickup
        ? "pickup"
        : offered.shipping
          ? "shipping"
          : undefined
      : undefined
  return { answer, to }
}
