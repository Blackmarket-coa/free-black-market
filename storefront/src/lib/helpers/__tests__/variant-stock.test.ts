import { describe, expect, it } from "vitest"

import { purchasableQuantity } from "@/lib/helpers/variant-stock"

describe("purchasableQuantity", () => {
  it("is the count Medusa reports for a variant it counts", () => {
    expect(purchasableQuantity({ manage_inventory: true, allow_backorder: false, inventory_quantity: 7 })).toBe(7)
    expect(purchasableQuantity({ manage_inventory: true, allow_backorder: false, inventory_quantity: 0 })).toBe(0)
  })

  it("is unlimited for a variant Medusa does not count, which carries no quantity", () => {
    // As GET /store/products returns it: `manage_inventory: false`, no `inventory_quantity` key.
    expect(purchasableQuantity({ manage_inventory: false, allow_backorder: false })).toBe(Infinity)
  })

  it("is unlimited for a variant that may be backordered, whatever the count", () => {
    expect(purchasableQuantity({ manage_inventory: true, allow_backorder: true, inventory_quantity: 0 })).toBe(Infinity)
  })

  it("is zero when there is no variant to add", () => {
    expect(purchasableQuantity(undefined)).toBe(0)
    expect(purchasableQuantity(null)).toBe(0)
  })

  it("is unlimited for a counted variant whose count was not reported: the cart decides, not a missing number", () => {
    // As the page's query without the stock count returns the counted pint
    // (a publishable key on more than one sales channel): `manage_inventory:
    // true`, no `inventory_quantity` key.
    expect(purchasableQuantity({ manage_inventory: true, allow_backorder: false })).toBe(Infinity)
    expect(purchasableQuantity({ manage_inventory: true, inventory_quantity: null })).toBe(Infinity)
    expect(purchasableQuantity({})).toBe(Infinity)
    // A reported zero is still none left.
    expect(purchasableQuantity({ manage_inventory: true, inventory_quantity: 0 })).toBe(0)
  })
})
