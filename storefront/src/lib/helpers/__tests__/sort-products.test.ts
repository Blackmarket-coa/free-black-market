import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import { sortProducts } from "../sort-products"
import type { SortOptions } from "@/types/product"

const product = (
  id: string,
  amounts: number[],
  createdAt?: string
): HttpTypes.StoreProduct =>
  ({
    id,
    created_at: createdAt,
    variants: amounts.map((amount) => ({
      id: `${id}-v`,
      calculated_price: { calculated_amount: amount },
    })),
  }) as unknown as HttpTypes.StoreProduct

describe("sortProducts", () => {
  it("sorts ascending by the cheapest variant price", () => {
    const result = sortProducts(
      [product("a", [3000]), product("b", [1000]), product("c", [2000])],
      "price_asc" as SortOptions
    )
    expect(result.map((p) => p.id)).toEqual(["b", "c", "a"])
  })

  it("sorts descending by the cheapest variant price", () => {
    const result = sortProducts(
      [product("a", [3000]), product("b", [1000])],
      "price_desc" as SortOptions
    )
    expect(result.map((p) => p.id)).toEqual(["a", "b"])
  })

  it("treats products without variants as most expensive (Infinity)", () => {
    const result = sortProducts(
      [product("none", []), product("cheap", [500])],
      "price_asc" as SortOptions
    )
    expect(result.map((p) => p.id)).toEqual(["cheap", "none"])
  })

  it("sorts by created_at descending (newest first)", () => {
    const result = sortProducts(
      [
        product("old", [1], "2020-01-01"),
        product("new", [1], "2024-01-01"),
        product("mid", [1], "2022-01-01"),
      ],
      "created_at" as SortOptions
    )
    expect(result.map((p) => p.id)).toEqual(["new", "mid", "old"])
  })
})
