import {
  decideStatusWrite,
  isExitState,
  isTerminalStatus,
} from "../shipment-lifecycle"

describe("blackstar shipment lifecycle: forward progress", () => {
  it("accepts the first status on a fresh shipment", () => {
    expect(decideStatusWrite(null, "claimed")).toEqual({
      apply: true,
      reason: "first_status",
    })
    expect(decideStatusWrite(undefined, "delivered").apply).toBe(true)
  })

  it("advances along the happy path", () => {
    expect(decideStatusWrite("claimed", "in_transit").apply).toBe(true)
    expect(decideStatusWrite("in_transit", "delivered").apply).toBe(true)
    expect(decideStatusWrite("claimed", "delivered").apply).toBe(true)
  })

  it("REFUSES to rewind a delivered shipment to in_transit", () => {
    // The defect this whole file exists for. At-least-once delivery with no
    // ordering guarantee means a delayed in_transit retry can land after
    // delivered; last-writer-wins would report a delivered parcel as still
    // travelling.
    const decision = decideStatusWrite("delivered", "in_transit")
    expect(decision.apply).toBe(false)
    expect(decision.reason).toBe("out_of_order")
  })

  it("refuses every backwards move along the path", () => {
    expect(decideStatusWrite("in_transit", "claimed").reason).toBe("out_of_order")
    expect(decideStatusWrite("delivered", "claimed").reason).toBe("out_of_order")
  })

  it("reports a duplicate as such rather than as progress", () => {
    expect(decideStatusWrite("delivered", "delivered")).toEqual({
      apply: false,
      reason: "same_status",
    })
  })
})

describe("blackstar shipment lifecycle: exits", () => {
  it("lets a shipment be disputed from anywhere on the path", () => {
    for (const from of ["claimed", "in_transit", "delivered"]) {
      expect(decideStatusWrite(from, "disputed").apply).toBe(true)
    }
  })

  it("lets a shipment be cancelled before it arrives", () => {
    expect(decideStatusWrite("claimed", "cancelled").apply).toBe(true)
    expect(decideStatusWrite("in_transit", "cancelled").apply).toBe(true)
  })

  it("treats delivered as NOT terminal — a delivered parcel can be disputed", () => {
    expect(isTerminalStatus("delivered")).toBe(false)
    expect(decideStatusWrite("delivered", "disputed").apply).toBe(true)
  })

  it("classifies the two exits", () => {
    expect(isExitState("disputed")).toBe(true)
    expect(isExitState("cancelled")).toBe(true)
    expect(isExitState("delivered")).toBe(false)
    expect(isExitState("in_transit")).toBe(false)
  })
})

describe("blackstar shipment lifecycle: terminal states", () => {
  it("never reopens a cancelled shipment", () => {
    for (const incoming of ["claimed", "in_transit", "delivered", "disputed"]) {
      const decision = decideStatusWrite("cancelled", incoming)
      expect(decision.apply).toBe(false)
      expect(decision.reason).toBe("terminal")
    }
  })

  it("never overwrites a dispute with a lifecycle event", () => {
    // Whatever happens after a dispute is a human decision recorded in
    // order_dispute, not a webhook quietly rewriting history.
    for (const incoming of ["claimed", "in_transit", "delivered", "cancelled"]) {
      expect(decideStatusWrite("disputed", incoming).reason).toBe("terminal")
    }
  })

  it("marks both exits terminal", () => {
    expect(isTerminalStatus("cancelled")).toBe(true)
    expect(isTerminalStatus("disputed")).toBe(true)
    expect(isTerminalStatus(null)).toBe(false)
    expect(isTerminalStatus(undefined)).toBe(false)
  })
})

describe("blackstar shipment lifecycle: unknown statuses", () => {
  it("never lets an unrecognised status overwrite a known one", () => {
    // A newer Blackstar may add lifecycle states. Guessing where one sits on
    // the line is worse than keeping the last known-good status.
    const decision = decideStatusWrite("in_transit", "quantum_superposition")
    expect(decision.apply).toBe(false)
    expect(decision.reason).toBe("unknown_status")
  })

  it("lets a known status land over an unknown one, so nothing wedges", () => {
    // The inverse: an unfamiliar current state must not freeze a shipment
    // permanently against events we do understand.
    expect(decideStatusWrite("some_future_state", "delivered").apply).toBe(true)
  })

  it("still treats an unknown status repeated as a duplicate", () => {
    expect(decideStatusWrite("weird", "weird").reason).toBe("same_status")
  })
})
