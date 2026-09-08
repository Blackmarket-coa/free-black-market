import OrderCycleModuleService from "../service"

/**
 * The share-box lifecycle table.
 *
 * `markShareBoxPacked`, `markShareBoxDispatched` and `cancelShareBox` each
 * write `status` unconditionally. Without this rule a coordinator could pack a
 * cancelled box, dispatch one that was never packed, or cancel a box that had
 * already physically gone out — the last being a false record, not just an odd
 * state.
 *
 * The model's docblock defines the order: pending -> allocated -> packed ->
 * dispatched, with `skipped` and `cancelled` off to the side.
 */

const ALL_STATES = [
  "pending",
  "allocated",
  "packed",
  "dispatched",
  "skipped",
  "cancelled",
] as const

const can = (from: string, to: string) =>
  OrderCycleModuleService.canTransitionShareBox(from, to)

describe("share-box lifecycle transitions", () => {
  describe("packing", () => {
    it("is allowed from the states that precede packing", () => {
      expect(can("pending", "packed")).toBe(true)
      expect(can("allocated", "packed")).toBe(true)
    })

    it("is refused once the box has gone out, been called off, or was skipped", () => {
      expect(can("dispatched", "packed")).toBe(false)
      expect(can("cancelled", "packed")).toBe(false)
      expect(can("skipped", "packed")).toBe(false)
    })

    it("is refused for a box already packed", () => {
      expect(can("packed", "packed")).toBe(false)
    })
  })

  describe("dispatching", () => {
    it("requires a packed box", () => {
      expect(can("packed", "dispatched")).toBe(true)
    })

    it("cannot skip the lifecycle from pending or allocated", () => {
      // The one that matters most: dispatching an unpacked box reports a
      // delivery nobody filled.
      expect(can("pending", "dispatched")).toBe(false)
      expect(can("allocated", "dispatched")).toBe(false)
    })

    it("cannot dispatch a cancelled, skipped or already-dispatched box", () => {
      expect(can("cancelled", "dispatched")).toBe(false)
      expect(can("skipped", "dispatched")).toBe(false)
      expect(can("dispatched", "dispatched")).toBe(false)
    })
  })

  describe("cancelling", () => {
    it("is allowed from every state that has not left", () => {
      expect(can("pending", "cancelled")).toBe(true)
      expect(can("allocated", "cancelled")).toBe(true)
      expect(can("packed", "cancelled")).toBe(true)
      expect(can("skipped", "cancelled")).toBe(true)
    })

    it("is refused once dispatched — the box physically went out", () => {
      expect(can("dispatched", "cancelled")).toBe(false)
    })

    it("is refused for an already-cancelled box", () => {
      expect(can("cancelled", "cancelled")).toBe(false)
    })
  })

  describe("the table as a whole", () => {
    it("names only real statuses on both sides", () => {
      const table = OrderCycleModuleService.SHARE_BOX_TRANSITIONS
      for (const [to, froms] of Object.entries(table)) {
        expect(ALL_STATES).toContain(to)
        for (const from of froms) expect(ALL_STATES).toContain(from)
      }
    })

    it("treats an unknown target as forbidden rather than allowed", () => {
      // A typo in a route must not open a transition.
      expect(can("pending", "allocated")).toBe(false)
      expect(can("pending", "nonsense")).toBe(false)
      expect(can("nonsense", "packed")).toBe(false)
    })

    it("never allows a transition out of dispatched", () => {
      for (const to of ALL_STATES) {
        expect(can("dispatched", to)).toBe(false)
      }
    })
  })
})
