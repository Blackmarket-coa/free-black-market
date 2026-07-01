import { describe, expect, it } from "vitest"
import type { TFunction } from "i18next"

import {
  getCanceledOrderStatus,
  getOrderFulfillmentStatus,
  getOrderPaymentStatus,
  getOrderStatus,
} from "./order-helpers"

// The helpers only use `t` to resolve a label; an identity stub keeps the
// assertions on the (translation-independent) status→color mapping.
const t = ((key: string) => key) as unknown as TFunction<"translation">

describe("getOrderStatus", () => {
  it("maps known statuses to their colors", () => {
    expect(getOrderStatus(t, "canceled")).toEqual({
      label: "orders.status.canceled",
      color: "red",
    })
    expect(getOrderStatus(t, "pending")).toEqual({
      label: "orders.status.pending",
      color: "orange",
    })
    expect(getOrderStatus(t, "completed")).toEqual({
      label: "orders.status.completed",
      color: "green",
    })
  })

  it("falls back to a neutral placeholder for unknown statuses", () => {
    expect(getOrderStatus(t, "not_a_real_status")).toEqual({
      label: "-",
      color: "orange",
    })
  })
})

describe("getOrderPaymentStatus", () => {
  it("maps a known status", () => {
    expect(getOrderPaymentStatus(t, "captured")).toEqual({
      label: "Payment Captured",
      color: "green",
    })
  })

  it("does not throw and falls back for statuses missing from the map (e.g. not_paid)", () => {
    expect(() => getOrderPaymentStatus(t, "not_paid")).not.toThrow()
    expect(getOrderPaymentStatus(t, "not_paid")).toEqual({
      label: "-",
      color: "orange",
    })
  })
})

describe("getOrderFulfillmentStatus", () => {
  it("maps a known status", () => {
    expect(getOrderFulfillmentStatus(t, "shipped")).toEqual({
      label: "orders.fulfillment.status.shipped",
      color: "green",
    })
  })

  it("does not throw and falls back for unknown statuses", () => {
    expect(() => getOrderFulfillmentStatus(t, "??")).not.toThrow()
    expect(getOrderFulfillmentStatus(t, "??")).toEqual({
      label: "-",
      color: "orange",
    })
  })
})

describe("getCanceledOrderStatus", () => {
  it("returns a badge only for canceled and completed", () => {
    expect(getCanceledOrderStatus(t, "canceled")).toEqual({
      label: "orders.status.canceled",
      color: "red",
    })
    expect(getCanceledOrderStatus(t, "completed")).toEqual({
      label: "orders.status.completed",
      color: "green",
    })
  })

  it("returns null for any other status", () => {
    expect(getCanceledOrderStatus(t, "pending")).toBeNull()
    expect(getCanceledOrderStatus(t, "")).toBeNull()
  })
})
