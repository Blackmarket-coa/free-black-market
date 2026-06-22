import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import { filterValidCartItems } from "../filter-valid-cart-items"

const item = (overrides: Partial<HttpTypes.StoreCartLineItem>) =>
  ({
    id: "li_1",
    subtotal: 1000,
    variant: { id: "variant_1" },
    ...overrides,
  }) as HttpTypes.StoreCartLineItem

describe("filterValidCartItems", () => {
  it("returns an empty array for null/undefined input", () => {
    expect(filterValidCartItems(null)).toEqual([])
    expect(filterValidCartItems(undefined)).toEqual([])
  })

  it("keeps items that have both a subtotal and a variant", () => {
    const items = [item({ id: "a" }), item({ id: "b" })]
    expect(filterValidCartItems(items)).toHaveLength(2)
  })

  it("drops items missing a subtotal", () => {
    const items = [
      item({ id: "ok" }),
      item({ id: "no-subtotal", subtotal: null as unknown as number }),
      item({ id: "undef-subtotal", subtotal: undefined as unknown as number }),
    ]
    const result = filterValidCartItems(items)
    expect(result.map((i) => i.id)).toEqual(["ok"])
  })

  it("drops items missing a variant", () => {
    const items = [
      item({ id: "ok" }),
      item({ id: "no-variant", variant: null as unknown as undefined }),
    ]
    const result = filterValidCartItems(items)
    expect(result.map((i) => i.id)).toEqual(["ok"])
  })
})
