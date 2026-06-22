import { describe, expect, it } from "vitest"
import type { ReadonlyURLSearchParams } from "next/navigation"
import { getFacedFilters } from "../get-faced-filters"

const params = (init: Record<string, string>) =>
  new URLSearchParams(init) as unknown as ReadonlyURLSearchParams

describe("getFacedFilters", () => {
  it("returns an empty string when there are no recognised filters", () => {
    expect(getFacedFilters(params({}))).toBe("")
    expect(getFacedFilters(params({ page: "2", query: "shoes" }))).toBe("")
  })

  it("maps a known facet key to its Algolia attribute", () => {
    expect(getFacedFilters(params({ size: "M" }))).toBe('(variants.size:"M")')
  })

  it("ORs multiple comma-separated values within a facet", () => {
    expect(getFacedFilters(params({ color: "red,blue" }))).toBe(
      '((variants.color:"red" OR variants.color:"blue"))'
    )
  })

  it("ANDs multiple distinct facets together", () => {
    const result = getFacedFilters(params({ size: "M", color: "red" }))
    expect(result).toBe('(variants.size:"M" AND variants.color:"red")')
  })

  it("builds a price range filter from min and max", () => {
    expect(getFacedFilters(params({ min_price: "10", max_price: "50" }))).toBe(
      "variants.prices.amount:10 TO 50"
    )
  })

  it("builds open-ended price filters", () => {
    expect(getFacedFilters(params({ min_price: "10" }))).toBe(
      "variants.prices.amount >= 10"
    )
    expect(getFacedFilters(params({ max_price: "50" }))).toBe(
      "variants.prices.amount <= 50"
    )
  })

  it("builds a rating filter that ORs each threshold", () => {
    expect(getFacedFilters(params({ rating: "4,5" }))).toBe(
      "(average_rating >= 4 OR average_rating >= 5)"
    )
  })

  it("combines facet, price, and rating with AND", () => {
    const result = getFacedFilters(
      params({ size: "M", min_price: "10", max_price: "50", rating: "4" })
    )
    expect(result).toBe(
      '(variants.size:"M") AND variants.prices.amount:10 TO 50 AND (average_rating >= 4)'
    )
  })
})
