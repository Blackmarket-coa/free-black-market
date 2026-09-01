import { describe, expect, it } from "vitest"
import {
  actionableFulfillment,
  isPhoneActionable,
  needsVendorAction,
  shipmentItemsFor,
  sortForVendorInbox,
  vendorOrderStage,
  vendorOrderStageLabel,
} from "../vendor-orders"

describe("vendorOrderStage", () => {
  it("maps each computed fulfillment status to a stage", () => {
    const cases: Array<[string, string]> = [
      ["not_fulfilled", "awaiting_fulfillment"],
      ["partially_fulfilled", "awaiting_fulfillment"],
      ["fulfilled", "ready_to_ship"],
      ["partially_shipped", "ready_to_ship"],
      ["shipped", "in_transit"],
      ["partially_delivered", "in_transit"],
      ["delivered", "closed"],
      ["canceled", "closed"],
    ]
    for (const [status, stage] of cases) {
      expect(vendorOrderStage({ id: "o", fulfillment_status: status })).toBe(
        stage
      )
    }
  })

  it("lets a cancelled or completed ORDER close it regardless of fulfillment", () => {
    expect(
      vendorOrderStage({
        id: "o",
        status: "canceled",
        fulfillment_status: "fulfilled",
      })
    ).toBe("closed")
    expect(
      vendorOrderStage({
        id: "o",
        status: "completed",
        fulfillment_status: "not_fulfilled",
      })
    ).toBe("closed")
  })

  it("defaults an unknown or missing status to needing packing", () => {
    expect(vendorOrderStage({ id: "o" })).toBe("awaiting_fulfillment")
    expect(vendorOrderStage({ id: "o", fulfillment_status: "weird" })).toBe(
      "awaiting_fulfillment"
    )
  })
})

describe("needsVendorAction / isPhoneActionable", () => {
  it("counts everything but closed as outstanding", () => {
    expect(needsVendorAction({ id: "o", fulfillment_status: "fulfilled" })).toBe(
      true
    )
    expect(needsVendorAction({ id: "o", fulfillment_status: "delivered" })).toBe(
      false
    )
  })

  it("only ships/delivers from the phone — packing stays on desktop", () => {
    expect(isPhoneActionable("ready_to_ship")).toBe(true)
    expect(isPhoneActionable("in_transit")).toBe(true)
    expect(isPhoneActionable("awaiting_fulfillment")).toBe(false)
    expect(isPhoneActionable("closed")).toBe(false)
  })

  it("labels every stage", () => {
    expect(vendorOrderStageLabel("ready_to_ship")).toBe("Ready to ship")
    expect(vendorOrderStageLabel("closed")).toBe("Complete")
  })
})

describe("sortForVendorInbox", () => {
  it("puts open work first, oldest first, and closed newest first", () => {
    const orders = [
      { id: "closed_old", fulfillment_status: "delivered", created_at: "2026-01-01T00:00:00Z" },
      { id: "open_new", fulfillment_status: "fulfilled", created_at: "2026-03-01T00:00:00Z" },
      { id: "closed_new", fulfillment_status: "delivered", created_at: "2026-04-01T00:00:00Z" },
      { id: "open_old", fulfillment_status: "not_fulfilled", created_at: "2026-02-01T00:00:00Z" },
    ]
    expect(sortForVendorInbox(orders).map((o) => o.id)).toEqual([
      "open_old",
      "open_new",
      "closed_new",
      "closed_old",
    ])
  })

  it("does not mutate its input and tolerates bad dates", () => {
    const orders = [
      { id: "a", fulfillment_status: "fulfilled", created_at: null },
      { id: "b", fulfillment_status: "fulfilled", created_at: "nonsense" },
    ]
    const copy = [...orders]
    sortForVendorInbox(orders)
    expect(orders).toEqual(copy)
  })
})

describe("actionableFulfillment", () => {
  it("ships the newest packed-but-unshipped fulfillment", () => {
    expect(
      actionableFulfillment(
        [{ id: "f1", delivered_at: "2026-01-01" }, { id: "f2" }, { id: "f3" }],
        "ship"
      )?.id
    ).toBe("f3")
  })

  it("never re-ships an already-shipped fulfillment", () => {
    // The bug this guards: shipped_at set but delivered_at null still reads
    // as "open", so a second shipment was posted and the backend rejected it.
    expect(
      actionableFulfillment([{ id: "f1", shipped_at: "2026-01-02" }], "ship")
    ).toBeNull()
  })

  it("delivers only a fulfillment that has actually shipped", () => {
    expect(
      actionableFulfillment(
        [{ id: "f1" }, { id: "f2", shipped_at: "2026-01-02" }],
        "deliver"
      )?.id
    ).toBe("f2")
    expect(actionableFulfillment([{ id: "f1" }], "deliver")).toBeNull()
  })

  it("skips cancelled and delivered ones for both intents", () => {
    const fulfillments = [
      { id: "f1", canceled_at: "2026-01-01" },
      { id: "f2", delivered_at: "2026-01-02" },
    ]
    expect(actionableFulfillment(fulfillments, "ship")).toBeNull()
    expect(actionableFulfillment(fulfillments, "deliver")).toBeNull()
  })

  it("handles absent input", () => {
    expect(actionableFulfillment(null, "ship")).toBeNull()
    expect(actionableFulfillment([], "deliver")).toBeNull()
  })
})

describe("shipmentItemsFor", () => {
  it("maps packed lines to the shipment payload shape", () => {
    expect(
      shipmentItemsFor({
        id: "f1",
        items: [
          { line_item_id: "li_1", quantity: 2 },
          { line_item_id: "li_2", quantity: 1 },
        ],
      })
    ).toEqual([
      { id: "li_1", quantity: 2 },
      { id: "li_2", quantity: 1 },
    ])
  })

  it("drops lines with no id or a non-positive quantity", () => {
    expect(
      shipmentItemsFor({
        id: "f1",
        items: [
          { line_item_id: null, quantity: 3 },
          { line_item_id: "li_2", quantity: 0 },
          { line_item_id: "li_3", quantity: null },
          { line_item_id: "li_4", quantity: 5 },
        ],
      })
    ).toEqual([{ id: "li_4", quantity: 5 }])
  })

  it("returns an empty array when there are no items", () => {
    expect(shipmentItemsFor({ id: "f1" })).toEqual([])
  })
})
