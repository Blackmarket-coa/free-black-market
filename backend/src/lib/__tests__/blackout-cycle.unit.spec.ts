import { toBlackoutCycleFields, cycleEventTypeFor } from "../blackout-cycle"
import {
  BLACKOUT_CYCLE_EVENTS,
  isBlackoutEventType,
} from "../../modules/marketplace-webhooks/models/blackout-events"

/**
 * The §3 order-cycle wire shape, and the guard that would have caught the
 * defect this replaces.
 *
 * `plant-ship-window.ts` emitted `order_cycle.closed` — a type absent from
 * `BLACKOUT_EVENT_TYPES`. `emitBlackout` throws on an unregistered type, and
 * throws *before* the `isBlackoutEmitConfigured()` gate, so it threw in every
 * environment; `emitBlackoutEvent` caught and logged it. The emit therefore
 * never enqueued anything, in any environment, since it shipped — and no test
 * noticed, because the wrapper swallows.
 */
const cycle = (over: Record<string, unknown> = {}) => ({
  id: "oc_1",
  name: "Spring Harvest",
  coordinator_seller_id: "sel_coord",
  status: "open",
  opens_at: new Date("2026-09-01T00:00:00.000Z"),
  closes_at: new Date("2026-09-15T00:00:00.000Z"),
  ...over,
})

describe("every emitted cycle type is registered", () => {
  it("passes the emitter's own guard", () => {
    // The regression. `emitBlackout` rejects an unregistered type by throwing
    // into a caller that swallows it, so an unregistered emit is silent —
    // which is exactly how the previous one survived.
    for (const type of BLACKOUT_CYCLE_EVENTS) {
      expect(isBlackoutEventType(type)).toBe(true)
    }
  })

  it("registers what cycleEventTypeFor can return, and nothing more", () => {
    // A type in the registry that nothing emits is the dead declaration this
    // whole change is about; a type emitted but unregistered is the bug.
    const emitted = ["open", "closed"]
      .map((s) => cycleEventTypeFor(s))
      .filter((t): t is string => t !== null)

    expect(emitted.sort()).toEqual([...BLACKOUT_CYCLE_EVENTS].sort())
    for (const type of emitted) expect(isBlackoutEventType(type)).toBe(true)
  })

  it("does not register sold_out, which FBM has no trigger for", () => {
    // Blackout accepts it; FBM decides sold-out per product, not per cycle.
    expect(isBlackoutEventType("sold_out")).toBe(false)
  })

  it("no longer registers the name the dead emit used", () => {
    expect(isBlackoutEventType("order_cycle.closed")).toBe(false)
  })
})

describe("cycleEventTypeFor", () => {
  it("maps the two transitions the sweep makes", () => {
    expect(cycleEventTypeFor("open")).toBe("cycle.open")
    expect(cycleEventTypeFor("closed")).toBe("cycle.close")
  })

  it("returns null for a status with no agreed meaning", () => {
    for (const s of ["draft", "upcoming", "cancelled", "nonsense"]) {
      expect(cycleEventTypeFor(s)).toBeNull()
    }
  })
})

describe("toBlackoutCycleFields", () => {
  it("maps the three fields Blackout requires", () => {
    expect(toBlackoutCycleFields(cycle())).toEqual({
      vendorId: "sel_coord",
      cycleId: "oc_1",
      name: "Spring Harvest",
      closingAt: "2026-09-15T00:00:00.000Z",
    })
  })

  it.each(["coordinator_seller_id", "id", "name"])(
    "returns null without %s, rather than enqueuing what Blackout will reject",
    (field) => {
      expect(toBlackoutCycleFields(cycle({ [field]: null }))).toBeNull()
      expect(toBlackoutCycleFields(cycle({ [field]: "" }))).toBeNull()
    }
  )

  it("omits closingAt rather than sending an empty one", () => {
    const fields = toBlackoutCycleFields(cycle({ closes_at: null }))
    expect(fields).not.toBeNull()
    expect(fields).not.toHaveProperty("closingAt")
  })

  it("accepts an ISO string as well as a Date", () => {
    expect(
      toBlackoutCycleFields(cycle({ closes_at: "2026-09-15T00:00:00.000Z" }))
        ?.closingAt
    ).toBe("2026-09-15T00:00:00.000Z")
  })

  it("sends nothing it would have to invent", () => {
    // items needs a product join (order_cycle_product carries variant_id, not
    // sku/title); ordersPlaced needs an order-to-cycle link that does not
    // exist yet; listingDeepLink would point at a storefront route that does
    // not exist. All three are optional in Blackout's parser.
    const fields = toBlackoutCycleFields(cycle())!
    expect(Object.keys(fields).sort()).toEqual([
      "closingAt",
      "cycleId",
      "name",
      "vendorId",
    ])
  })
})
