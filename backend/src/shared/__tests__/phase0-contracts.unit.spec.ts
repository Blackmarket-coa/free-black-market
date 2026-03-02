import { inventoryLedgerEventSchema } from "../phase0-contracts"

describe("inventoryLedgerEventSchema", () => {
  it("accepts inventory transitions and defaults to update", () => {
    const now = new Date().toISOString()

    expect(
      inventoryLedgerEventSchema.parse({
        event_id: "evt_1",
        occurred_at: now,
        product_id: "prod_1",
        variant_id: "var_1",
        delta: -1,
        reason: "checkout",
        channel: "storefront",
      }).transition
    ).toBe("update")

    expect(
      inventoryLedgerEventSchema.parse({
        event_id: "evt_2",
        occurred_at: now,
        product_id: "prod_1",
        variant_id: "var_1",
        delta: 4,
        reason: "restock",
        transition: "reconcile",
        channel: "storefront",
      }).transition
    ).toBe("reconcile")
  })
})
