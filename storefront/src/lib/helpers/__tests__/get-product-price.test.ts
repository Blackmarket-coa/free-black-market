import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { Hit } from "instantsearch.js"
import { getPricesForVariant, getProductPrice } from "../get-product-price"

const withTaxVariant = {
  id: "var_with_tax",
  sku: "SKU-TAX",
  calculated_price: {
    calculated_amount: 1000,
    calculated_amount_with_tax: 1200,
    calculated_amount_without_tax: 1000,
    original_amount: 1500,
    original_amount_with_tax: 1800,
    currency_code: "usd",
    calculated_price: { price_list_type: "sale" },
  },
}

const noTaxVariant = {
  id: "var_no_tax",
  sku: "SKU-NOTAX",
  calculated_price: {
    calculated_amount: 2000,
    calculated_amount_without_tax: 1900,
    original_amount: 2500,
    currency_code: "usd",
    calculated_price: { price_list_type: "default" },
  },
}

const asProduct = (variants: unknown[]) =>
  ({ id: "prod_1", variants }) as unknown as Hit<HttpTypes.StoreProduct>

describe("getPricesForVariant", () => {
  it("returns null when there is no calculated price", () => {
    expect(getPricesForVariant(null)).toBeNull()
    expect(getPricesForVariant({ id: "x", calculated_price: {} })).toBeNull()
  })

  it("uses tax-inclusive amounts when available", () => {
    const price = getPricesForVariant(withTaxVariant)
    expect(price).not.toBeNull()
    expect(price?.calculated_price_number).toBe(1200)
    expect(price?.original_price_number).toBe(1800)
    expect(price?.currency_code).toBe("usd")
    expect(price?.price_type).toBe("sale")
    expect(price?.calculated_price).toBe("$1,200.00")
  })

  it("falls back to tax-exclusive amounts when no tax-inclusive value exists", () => {
    const price = getPricesForVariant(noTaxVariant)
    expect(price).not.toBeNull()
    expect(price?.calculated_price_number).toBe(2000)
    expect(price?.original_price_number).toBe(2500)
    expect(price?.price_type).toBe("default")
  })
})

describe("getProductPrice", () => {
  it("throws when no product is provided", () => {
    expect(() =>
      getProductPrice({
        product: {} as Hit<HttpTypes.StoreProduct>,
      })
    ).toThrow("No product provided")
  })

  it("returns the cheapest variant and its price", () => {
    const { cheapestPrice, cheapestVariant } = getProductPrice({
      product: asProduct([noTaxVariant, withTaxVariant]),
    })
    // withTaxVariant (1200) is cheaper than noTaxVariant (2000)
    expect(cheapestVariant?.id).toBe("var_with_tax")
    expect(cheapestPrice?.calculated_price_number).toBe(1200)
  })

  it("resolves a specific variant price by id", () => {
    const { variantPrice } = getProductPrice({
      product: asProduct([noTaxVariant, withTaxVariant]),
      variantId: "var_no_tax",
    })
    expect(variantPrice?.calculated_price_number).toBe(2000)
  })

  it("resolves a specific variant price by sku", () => {
    const { variantPrice } = getProductPrice({
      product: asProduct([withTaxVariant]),
      variantId: "SKU-TAX",
    })
    expect(variantPrice?.calculated_price_number).toBe(1200)
  })

  it("returns null prices when there are no variants", () => {
    const { cheapestPrice, variantPrice } = getProductPrice({
      product: asProduct([]),
      variantId: "anything",
    })
    expect(cheapestPrice).toBeNull()
    expect(variantPrice).toBeNull()
  })
})
