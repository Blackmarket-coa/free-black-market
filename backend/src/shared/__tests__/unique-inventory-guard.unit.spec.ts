import { assertUniqueInventoryConstraints } from "../listing-type-guard"

/**
 * `unique_inventory` (one-of-a-kind) listings are locked to a single unit. The
 * guard rejects a product-create payload that stocks more than one of a managed
 * variant, while staying defensive: it never fires for other listing-types, for
 * unmanaged variants, or when a payload omits the quantity entirely.
 */
describe("assertUniqueInventoryConstraints", () => {
  it("no-ops for non one-of-a-kind types even with large stock", () => {
    expect(() =>
      assertUniqueInventoryConstraints("physical_product", {
        variants: [{ inventory_quantity: 500, manage_inventory: true }],
      })
    ).not.toThrow()
  })

  it("allows exactly one unit for a one-of-a-kind listing", () => {
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", {
        variants: [{ inventory_quantity: 1, manage_inventory: true }],
      })
    ).not.toThrow()
  })

  it("rejects a managed variant stocking more than one", () => {
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", {
        variants: [{ inventory_quantity: 3, manage_inventory: true }],
      })
    ).toThrow(/single/)
  })

  it("catches the offending variant among several", () => {
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", {
        variants: [
          { inventory_quantity: 1, manage_inventory: true },
          { inventory_quantity: 5, manage_inventory: true },
        ],
      })
    ).toThrow()
  })

  it("ignores unmanaged variants (inventory not tracked)", () => {
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", {
        variants: [{ inventory_quantity: 99, manage_inventory: false }],
      })
    ).not.toThrow()
  })

  it("does not fire when quantity is omitted (defers to inventory-level rules)", () => {
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", {
        variants: [{ manage_inventory: true }],
      })
    ).not.toThrow()
  })

  it("no-ops with missing or empty product data", () => {
    expect(() => assertUniqueInventoryConstraints("unique_inventory", null)).not.toThrow()
    expect(() => assertUniqueInventoryConstraints("unique_inventory", {})).not.toThrow()
    expect(() =>
      assertUniqueInventoryConstraints("unique_inventory", { variants: [] })
    ).not.toThrow()
  })
})
