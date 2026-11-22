import { describe, expect, it } from "vitest"
import {
  deliveryAnswerIsShown,
  deliveryNudgeFor,
  isFailedDeliveryCheck,
  isOutsideDeliveryZones,
  NO_DELIVERY_NUDGE,
} from "../delivery-eligibility"

/**
 * What the delivery step does with the delivery-zone check's answer. The
 * answers are the backend's (`backend/src/api/store/delivery-zones/check/
 * route.ts`) and the storefront's own two for a check it could not make.
 */

const OUTSIDE = {
  available: false,
  code: "DELIVERY_NOT_AVAILABLE",
  reason: "Outside delivery area. We don't currently deliver to your location.",
  suggestion: "You may be able to order for pickup instead.",
  next_action: "switch_to_pickup",
}
const NO_ZONES = { available: false, code: "DELIVERY_ZONES_UNAVAILABLE", reason: "No delivery zones are currently configured" }
const FAILED = { available: false, code: "DELIVERY_CHECK_FAILED", reason: "We couldn't check delivery to your address just now." }
const UNPLACED = { available: false, code: "DELIVERY_COORDINATES_UNAVAILABLE" }
const AVAILABLE = { available: true, code: "DELIVERY_AVAILABLE", message: "Delivery available! Estimated 20-30 min" }
const CLOSED = { available: true, code: "DELIVERY_ZONE_CLOSED", message: "Delivery zone found but currently closed. Check service hours." }

const both = { pickup: true, shipping: true }

describe("what each answer is", () => {
  it("tells \"outside every zone\" from \"could not check\" and from \"no zones at all\"", () => {
    expect(isOutsideDeliveryZones(OUTSIDE)).toBe(true)
    for (const answer of [NO_ZONES, FAILED, UNPLACED, AVAILABLE, CLOSED, null]) {
      expect(isOutsideDeliveryZones(answer)).toBe(false)
    }
    expect(isFailedDeliveryCheck(FAILED)).toBe(true)
    expect(isFailedDeliveryCheck(UNPLACED)).toBe(true)
    expect(isFailedDeliveryCheck(OUTSIDE)).toBe(false)
    expect(isFailedDeliveryCheck(NO_ZONES)).toBe(false)
  })

  it("has nothing to show for a store with no delivery zones, or with no answer", () => {
    expect(deliveryAnswerIsShown(NO_ZONES)).toBe(false)
    expect(deliveryAnswerIsShown(null)).toBe(false)
    for (const answer of [OUTSIDE, FAILED, UNPLACED, AVAILABLE, CLOSED]) {
      expect(deliveryAnswerIsShown(answer)).toBe(true)
    }
  })
})

describe("deliveryNudgeFor", () => {
  it("pre-selects Pickup for an address outside every zone, and Shipping when there is no Pickup", () => {
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, both, undefined)).toEqual({ answer: OUTSIDE, to: "pickup" })
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, { pickup: false, shipping: true }, undefined).to).toBe("shipping")
  })

  it("moves a buyer who had picked Delivery before the answer came", () => {
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, both, "delivery").to).toBe("pickup")
  })

  it("acts on an answer once: a buyer who switches back to Delivery is not moved again", () => {
    const nudged = deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, both, undefined)
    expect(nudged.to).toBe("pickup")

    // The buyer picks Delivery after all; the same answer is still on the page.
    const again = deliveryNudgeFor(nudged, OUTSIDE, both, "delivery")

    expect(again).toBe(nudged)
  })

  it("leaves the buyer on Delivery when the sellers offer nothing else", () => {
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, { pickup: false, shipping: false }, undefined).to).toBeUndefined()
  })

  it("does not move a buyer who already picked Pickup or Shipping", () => {
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, both, "shipping").to).toBeUndefined()
    expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, OUTSIDE, both, "pickup").to).toBeUndefined()
  })

  it("moves no one for a store with no zones, a check that could not be made, or delivery that is available", () => {
    for (const answer of [NO_ZONES, FAILED, UNPLACED, AVAILABLE, CLOSED]) {
      expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, answer, both, undefined).to).toBeUndefined()
      expect(deliveryNudgeFor(NO_DELIVERY_NUDGE, answer, both, "delivery").to).toBeUndefined()
    }
  })

  it("acts on a new answer (another postal code) afresh, and on none not at all", () => {
    const first = deliveryNudgeFor(NO_DELIVERY_NUDGE, AVAILABLE, both, undefined)
    expect(first).toEqual({ answer: AVAILABLE, to: undefined })
    expect(deliveryNudgeFor(first, { ...OUTSIDE }, both, undefined).to).toBe("pickup")
    expect(deliveryNudgeFor(first, null, both, undefined)).toBe(first)
  })
})
