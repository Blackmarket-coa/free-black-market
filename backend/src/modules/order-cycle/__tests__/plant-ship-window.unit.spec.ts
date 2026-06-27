import { evaluateShipWindow } from "../plant-ship-window"

const NOW = new Date("2026-04-15T00:00:00Z")
const past = new Date("2026-01-01T00:00:00Z")
const future = new Date("2026-09-01T00:00:00Z")

describe("plant-ship-window: evaluateShipWindow", () => {
  it("is available inside the window with stock", () => {
    const r = evaluateShipWindow(
      { opensAt: past, closesAt: future, allowPreorder: false, inventoryKnownZero: false },
      NOW
    )
    expect(r).toMatchObject({ orderable: true, reason: "available" })
  })

  it("blocks before the window opens (no preorder)", () => {
    const r = evaluateShipWindow(
      { opensAt: future, closesAt: null, allowPreorder: false, inventoryKnownZero: false },
      NOW
    )
    expect(r).toMatchObject({ orderable: false, reason: "window_not_open", preorder_available: false })
  })

  it("allows preorder before the window opens when enabled", () => {
    const r = evaluateShipWindow(
      { opensAt: future, closesAt: null, allowPreorder: true, inventoryKnownZero: false },
      NOW
    )
    expect(r).toMatchObject({ orderable: true, reason: "window_not_open", preorder_available: true })
  })

  it("blocks after the window closes", () => {
    const r = evaluateShipWindow(
      { opensAt: past, closesAt: past, allowPreorder: true, inventoryKnownZero: false },
      NOW
    )
    expect(r).toMatchObject({ orderable: false, reason: "window_closed" })
  })

  it("reports sold_out when in-window but inventory is known-zero", () => {
    const r = evaluateShipWindow(
      { opensAt: null, closesAt: null, allowPreorder: false, inventoryKnownZero: true },
      NOW
    )
    expect(r).toMatchObject({ orderable: false, reason: "sold_out" })
  })

  it("is available with no window constraints and unknown inventory", () => {
    const r = evaluateShipWindow(
      { opensAt: null, closesAt: null, allowPreorder: false, inventoryKnownZero: false },
      NOW
    )
    expect(r.orderable).toBe(true)
  })
})
