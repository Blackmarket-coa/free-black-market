import { describe, expect, it } from "vitest"
import {
  getPricesForVariant,
  getSellerProductPrice,
} from "../get-seller-product-price"

const variant = (id: string, amount: number) => ({
  id,
  sku: `SKU-${id}`,
  prices: [{ amount, currency_code: "usd" }],
})

describe("getSellerProductPrice: getPricesForVariant", () => {
  it("returns null when there is no price", () => {
    expect(getPricesForVariant(null)).toBeNull()
    expect(getPricesForVariant({ id: "x", prices: [] })).toBeNull()
    expect(getPricesForVariant({ id: "x", prices: null })).toBeNull()
  })

  it("formats the first price entry", () => {
    const price = getPricesForVariant(variant("a", 2500))
    expect(price?.calculated_price_number).toBe(2500)
    expect(price?.original_price_number).toBe(2500)
    expect(price?.calculated_price).toBe("$2,500.00")
  })
})

describe("getSellerProductPrice", () => {
  it("throws when no product is provided", () => {
    expect(() =>
      getSellerProductPrice({ product: {} })
    ).toThrow("No product provided")
  })

  it("returns the cheapest variant price", () => {
    const { cheapestPrice } = getSellerProductPrice({
      product: { id: "p1", variants: [variant("a", 3000), variant("b", 1000)] },
    })
    expect(cheapestPrice?.calculated_price_number).toBe(1000)
  })

  it("resolves a specific variant price by id and sku", () => {
    const product = {
      id: "p1",
      variants: [variant("a", 3000), variant("b", 1000)],
    }
    expect(
      getSellerProductPrice({ product, variantId: "a" }).variantPrice
        ?.calculated_price_number
    ).toBe(3000)
    expect(
      getSellerProductPrice({ product, variantId: "SKU-b" }).variantPrice
        ?.calculated_price_number
    ).toBe(1000)
  })

  it("returns null prices when there are no variants", () => {
    const { cheapestPrice, variantPrice } = getSellerProductPrice({
      product: { id: "p1", variants: [] },
      variantId: "a",
    })
    expect(cheapestPrice).toBeNull()
    expect(variantPrice).toBeNull()
  })
})
