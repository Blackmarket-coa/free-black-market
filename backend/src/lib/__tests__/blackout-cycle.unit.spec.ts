import {
  countCycleOrders,
  cycleEventTypeFor,
  toBlackoutCycleFields,
} from "../blackout-cycle"
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
    // sku/title); listingDeepLink would point at a storefront route that does
    // not exist. Both are optional in Blackout's parser.
    //
    // `ordersPlaced` is not on this list any more, but it is not on the
    // projection either: it needs a database read, so the job adds it after
    // this function returns. This projection stays pure.
    const fields = toBlackoutCycleFields(cycle())!
    expect(Object.keys(fields).sort()).toEqual([
      "closingAt",
      "cycleId",
      "name",
      "vendorId",
    ])
  })
})

jest.mock("../../links/order-order-cycle", () => ({
  __esModule: true,
  default: { entryPoint: "order_order_ordercyclemodule_order_cycle" },
}))

describe("countCycleOrders", () => {
  const queryReturning = (data: unknown) => ({
    graph: jest.fn().mockResolvedValue({ data }),
  })

  it("counts the link rows for the cycle it was asked about", async () => {
    const query = queryReturning([{ order_id: "o_1" }, { order_id: "o_2" }])

    await expect(countCycleOrders(query, "oc_1")).resolves.toBe(2)

    // Filtered by cycle, not by anything the caller has to remember to pass.
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order_order_ordercyclemodule_order_cycle",
        fields: ["order_id"],
        filters: { order_cycle_id: "oc_1" },
      })
    )
  })

  it("reports a genuine zero as zero", async () => {
    // A cycle that closed having sold nothing is a real, reportable outcome.
    // Blackout renders "0 order(s) placed" for it, which is true.
    await expect(countCycleOrders(queryReturning([]), "oc_1")).resolves.toBe(0)
  })

  it("returns undefined rather than zero when the read fails", async () => {
    // The distinction this whole function exists for. Blackout drops the
    // clause on undefined and prints "0 order(s) placed" on zero, so
    // collapsing a failed read into 0 would announce a confident falsehood in
    // the vendor's room.
    const query = {
      graph: jest.fn().mockRejectedValue(new Error("relation does not exist")),
    }

    await expect(countCycleOrders(query, "oc_1")).resolves.toBeUndefined()
  })

  it("returns undefined when the query answers with no rows array at all", async () => {
    // Not the same as an empty array: `data: undefined` means the read did not
    // produce a result set, which is a failure, not a count of nothing.
    await expect(
      countCycleOrders(queryReturning(undefined), "oc_1")
    ).resolves.toBeUndefined()
  })

  it("never throws into the five-minute sweep", async () => {
    // The caller is a scheduled job that also performs the status transition.
    // An optional display field must not be able to fail the transition.
    const query = {
      graph: jest.fn(() => {
        throw new Error("synchronous blow-up")
      }),
    }

    await expect(countCycleOrders(query, "oc_1")).resolves.toBeUndefined()
  })
})
