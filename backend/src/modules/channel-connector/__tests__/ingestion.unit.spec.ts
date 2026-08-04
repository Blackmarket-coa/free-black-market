import {
  decideIngestion,
  nextOrderCursor,
  planChannelInventoryAdjustments,
  type ChannelVariantContext,
} from "../ingestion"
import type { ChannelOrder } from "../types"

/**
 * Phase 10's premise is that FBM and channel sales decrement one pool. These
 * cover the two ways that goes wrong expensively: stock moving twice for one
 * sale, and stock not moving at all for a sale that happened.
 */

const variant = (
  sku: string,
  overrides: Partial<ChannelVariantContext> = {}
): ChannelVariantContext => ({
  sku,
  variant_id: `var_${sku}`,
  manage_inventory: true,
  inventory_item_id: `iitem_${sku}`,
  location_id: "sloc_1",
  ...overrides,
})

describe("planChannelInventoryAdjustments", () => {
  it("plans a decrement per matched SKU", () => {
    const plan = planChannelInventoryAdjustments(
      [{ sku: "A", quantity: 3 }],
      [variant("A")]
    )
    expect(plan.adjustments).toEqual([
      {
        sku: "A",
        variant_id: "var_A",
        inventory_item_id: "iitem_A",
        location_id: "sloc_1",
        quantity: 3,
      },
    ])
    expect(plan.skipped).toEqual([])
  })

  it("aggregates a SKU that appears on several lines", () => {
    // Two decrements of 2 and 3 against the same item is two round trips that
    // can half-fail; one of 5 cannot.
    const plan = planChannelInventoryAdjustments(
      [
        { sku: "A", quantity: 2 },
        { sku: "A", quantity: 3 },
      ],
      [variant("A")]
    )
    expect(plan.adjustments).toHaveLength(1)
    expect(plan.adjustments[0].quantity).toBe(5)
  })

  it("reports an unmatched SKU rather than ignoring it", () => {
    // The load-bearing case. A silently skipped line means stock did not move
    // for a real sale, and the vendor finds out by overselling.
    const plan = planChannelInventoryAdjustments(
      [{ sku: "GHOST", quantity: 1 }],
      [variant("A")]
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped).toEqual([{ sku: "GHOST", reason: "unknown_sku" }])
  })

  it("reports a line with no SKU at all", () => {
    const plan = planChannelInventoryAdjustments(
      [{ sku: null, quantity: 1 }],
      [variant("A")]
    )
    expect(plan.skipped).toEqual([{ sku: "", reason: "no_sku" }])
  })

  it("distinguishes why each line could not be decremented", () => {
    // The reasons need to differ: "not_managed" is a deliberate configuration,
    // the other two are setup problems an operator has to fix.
    const plan = planChannelInventoryAdjustments(
      [
        { sku: "UNMANAGED", quantity: 1 },
        { sku: "NOITEM", quantity: 1 },
        { sku: "NOLOC", quantity: 1 },
      ],
      [
        variant("UNMANAGED", { manage_inventory: false }),
        variant("NOITEM", { inventory_item_id: null }),
        variant("NOLOC", { location_id: null }),
      ]
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual([
      "no_inventory_item",
      "no_location_level",
      "not_managed",
    ])
  })

  it("ignores a zero-quantity line without calling it unmatched", () => {
    const plan = planChannelInventoryAdjustments(
      [{ sku: "A", quantity: 0 }],
      [variant("A")]
    )
    expect(plan.adjustments).toEqual([])
    expect(plan.skipped).toEqual([])
  })

  it("clamps a nonsense quantity rather than decrementing by it", () => {
    const plan = planChannelInventoryAdjustments(
      [
        { sku: "A", quantity: -5 },
        { sku: "B", quantity: 2.7 },
      ],
      [variant("A"), variant("B")]
    )
    // A negative "sale" would *increase* stock — never from this path.
    expect(plan.adjustments.find((a) => a.sku === "A")).toBeUndefined()
    expect(plan.adjustments.find((a) => a.sku === "B")?.quantity).toBe(2)
  })

  it("matches a SKU with incidental whitespace", () => {
    const plan = planChannelInventoryAdjustments(
      [{ sku: "  A  ", quantity: 1 }],
      [variant("A")]
    )
    expect(plan.adjustments).toHaveLength(1)
  })
})

describe("decideIngestion", () => {
  it("ingests an order never seen before", () => {
    expect(decideIngestion(null)).toEqual({ action: "ingest" })
  })

  it("skips an order whose stock effect already landed", () => {
    // The double-decrement guard. Without it, every poll would take stock
    // again for the same sale and manufacture a stockout.
    expect(
      decideIngestion({ id: "co_1", inventory_applied: true })
    ).toEqual({ action: "skip" })
  })

  it("retries only the inventory half after a crash between the two steps", () => {
    // Recorded but never decremented — the oversell case. This is the state
    // the `inventory_applied` flag exists to make recoverable.
    expect(
      decideIngestion({ id: "co_1", inventory_applied: false })
    ).toEqual({ action: "apply_inventory", order_id: "co_1" })
  })
})

describe("nextOrderCursor", () => {
  const order = (iso: string): ChannelOrder =>
    ({ placed_at: new Date(iso) }) as ChannelOrder

  it("advances to the latest order actually ingested", () => {
    const cursor = nextOrderCursor(new Date("2026-08-01T00:00:00Z"), [
      order("2026-08-02T10:00:00Z"),
      order("2026-08-03T09:00:00Z"),
      order("2026-08-02T23:00:00Z"),
    ])
    expect(cursor?.toISOString()).toBe("2026-08-03T09:00:00.000Z")
  })

  it("does not move on an empty poll", () => {
    const previous = new Date("2026-08-01T00:00:00Z")
    expect(nextOrderCursor(previous, [])).toBe(previous)
  })

  it("never moves backwards", () => {
    // A channel returning an older order must not rewind the cursor and cause
    // everything since to be re-read forever.
    const previous = new Date("2026-08-05T00:00:00Z")
    expect(nextOrderCursor(previous, [order("2026-08-01T00:00:00Z")])).toBe(
      previous
    )
  })

  it("ignores an unparseable timestamp rather than poisoning the cursor", () => {
    const previous = new Date("2026-08-01T00:00:00Z")
    const bad = { placed_at: new Date("nonsense") } as ChannelOrder
    expect(nextOrderCursor(previous, [bad])).toBe(previous)
  })

  it("starts a never-synced connection from the orders it saw", () => {
    const cursor = nextOrderCursor(null, [order("2026-08-02T10:00:00Z")])
    expect(cursor?.toISOString()).toBe("2026-08-02T10:00:00.000Z")
  })
})
