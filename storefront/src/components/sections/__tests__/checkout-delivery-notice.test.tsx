import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DeliveryEligibilityNotice } from "../CartShippingMethodsSection/DeliveryEligibilityNotice"

/**
 * What the delivery step tells the buyer about the delivery-zone check.
 *
 * Reviewed states: every buyer who picked Delivery on a store with no
 * delivery zones read "No delivery zones are currently configured"; a buyer
 * outside every zone was told so and left on Delivery, which nothing
 * downstream refuses. The second is now a nudge (Pickup or Shipping
 * pre-selected once, lib/helpers/delivery-eligibility.ts) whose reason has to
 * stay in view after the selection moved.
 *
 * The notice alone, rendered to markup. The step applies the nudge in an
 * effect when the answer arrives, which a server render does not run and
 * this workspace's vitest has no DOM library for; which type an answer
 * pre-selects, and that it does so once, is the helper's test.
 */

// The storefront's vitest compiles JSX to the classic `React.createElement`.
;(globalThis as { React?: typeof React }).React = React

const OUTSIDE = {
  available: false,
  code: "DELIVERY_NOT_AVAILABLE",
  reason: "Outside delivery area. We don't currently deliver to your location.",
  suggestion: "You may be able to order for pickup instead.",
}
const NO_ZONES = { available: false, code: "DELIVERY_ZONES_UNAVAILABLE", reason: "No delivery zones are currently configured" }
const FAILED = {
  available: false,
  code: "DELIVERY_CHECK_FAILED",
  reason: "We couldn't check delivery to your address just now.",
  suggestion: "You can still choose a delivery option, or pick another way to receive your order.",
}
const AVAILABLE = { available: true, code: "DELIVERY_AVAILABLE", message: "Delivery available! Estimated 20-30 min" }

type Props = React.ComponentProps<typeof DeliveryEligibilityNotice>
const notice = (props: Partial<Props>) =>
  renderToStaticMarkup(
    <DeliveryEligibilityNotice answer={null} checking={false} selected="delivery" nudgedTo={undefined} {...props} />
  )

describe("the delivery step's notice about the delivery-zone check", () => {
  it("shows nothing for a store with no delivery zones configured, whatever is selected", () => {
    expect(notice({ answer: NO_ZONES, selected: "delivery" })).toBe("")
    expect(notice({ answer: NO_ZONES, selected: "pickup" })).toBe("")
    expect(notice({ answer: NO_ZONES, selected: undefined })).toBe("")
  })

  it("keeps the reason in view after it pre-selected Pickup, and says Delivery can still be chosen", () => {
    const html = notice({ answer: OUTSIDE, selected: "pickup", nudgedTo: "pickup" })

    expect(html).toContain('data-testid="delivery-nudge"')
    expect(html).toContain("Outside delivery area. We don&#x27;t currently deliver to your location.")
    expect(html).toContain("We&#x27;ve selected Pickup instead. You can still choose Delivery.")
  })

  it("names Shipping when that is what it pre-selected, and says when the check is approximate", () => {
    const html = notice({ answer: { ...OUTSIDE, approximate: true }, selected: "shipping", nudgedTo: "shipping" })

    expect(html).toContain("We&#x27;ve selected Shipping instead. You can still choose Delivery: this check goes by your postal code, so it is approximate.")
  })

  it("tells a buyer who switched back to Delivery why it may not reach them", () => {
    const html = notice({ answer: OUTSIDE, selected: "delivery", nudgedTo: "pickup" })

    expect(html).toContain('data-testid="delivery-eligibility"')
    expect(html).toContain("Outside delivery area.")
    expect(html).toContain("You may be able to order for pickup instead.")
    expect(html).not.toContain("instead. You can still choose Delivery")
  })

  it("says nothing beside Pickup or Shipping that the buyer picked themselves", () => {
    expect(notice({ answer: OUTSIDE, selected: "shipping", nudgedTo: undefined })).toBe("")
    // Nudged to Pickup, then the buyer chose Shipping: "selected Pickup" would be untrue.
    expect(notice({ answer: OUTSIDE, selected: "shipping", nudgedTo: "pickup" })).toBe("")
  })

  it("says a check that could not be made could not be made, beside Delivery only", () => {
    const html = notice({ answer: FAILED, selected: "delivery" })

    expect(html).toContain("We couldn&#x27;t check delivery to your address just now.")
    expect(html).toContain("You can still choose a delivery option")
    expect(notice({ answer: FAILED, selected: "pickup" })).toBe("")
  })

  it("confirms delivery that is available, and says when it is still checking", () => {
    expect(notice({ answer: AVAILABLE })).toContain("Delivery available! Estimated 20-30 min")
    expect(notice({ checking: true })).toContain("Checking delivery to your postal code...")
    expect(notice({ checking: true, selected: "pickup" })).toBe("")
  })
})
