import { describe, expect, it } from "vitest"

import {
  PRODUCT_LIST_FIELDS,
  PRODUCT_PAGE_FIELDS,
  asksForPrices,
  pricingContext,
  productListQuery,
  productPageQuery,
} from "@/lib/data/product-query"

/**
 * The field lists the storefront sends `GET /store/products`. That the backend
 * serves them is proven against a real database in
 * `backend/integration-tests/http/store-product-page-query.spec.ts`, which
 * loads the same module; this pins what each list must keep asking for, by the
 * component that reads it.
 */

const fieldsOf = (list: string) => list.split(",")

describe("PRODUCT_PAGE_FIELDS", () => {
  it.each([
    ["the variants a buyer chooses between", "*variants"],
    ["each variant's options, matched to the picker", "*variants.options"],
    ["each variant's price in the region", "*variants.calculated_price"],
    ["how many of a variant are left", "variants.inventory_quantity"],
    ["the option picker", "*options"],
    ["the option picker's values", "*options.values"],
    ["the gallery", "*images"],
    ["the tag chips", "*tags"],
    ["the description accordion", "description"],
    ["the posted date", "created_at"],
    ["the subscribe marker", "metadata"],
    ["the seller block", "seller.name"],
    ["the seller link and trust lookup", "seller.handle"],
    ["the suspended-seller gate", "seller.store_status"],
    ["the seller's reviews", "seller.reviews.rating"],
    ["more from this seller", "seller.products.handle"],
    ["additional attributes", "attribute_values.attribute.name"],
  ])("asks for %s", (_what, field) => {
    expect(fieldsOf(PRODUCT_PAGE_FIELDS)).toContain(field)
  })

  it("is not the five scalar fields the workaround sent", () => {
    expect(PRODUCT_PAGE_FIELDS).not.toBe("id,title,handle,thumbnail,status")
  })
})

describe("PRODUCT_LIST_FIELDS", () => {
  it.each([
    ["the card's price", "*variants.calculated_price"],
    ["the seller's name on the card", "seller.name"],
    ["the seller filter", "seller.id"],
    ["the seller-page filter", "seller.handle"],
    ["the suspended-seller gate", "seller.store_status"],
    ["the newest-first sort", "created_at"],
    ["the category facet", "categories.name"],
  ])("asks for %s", (_what, field) => {
    expect(fieldsOf(PRODUCT_LIST_FIELDS)).toContain(field)
  })

  it("stays light: no images, options or per-variant stock", () => {
    for (const heavy of ["*images", "*options", "*variants", "variants.inventory_quantity", "seller.products.id"]) {
      expect(fieldsOf(PRODUCT_LIST_FIELDS)).not.toContain(heavy)
    }
  })
})

describe("the seller on either list", () => {
  it.each([
    ["page", PRODUCT_PAGE_FIELDS],
    ["list", PRODUCT_LIST_FIELDS],
  ])("%s fields name the seller's public columns and never expand the row", (_name, list) => {
    // `*seller` returns the seller's email, phone, address and tax id, and the
    // product is serialised to the browser by the client components it is
    // handed to.
    for (const field of fieldsOf(list)) {
      expect(field).not.toMatch(/^[*+]?seller$/)
      expect(field).not.toMatch(/^\*seller\.?/)
      expect(field).not.toMatch(/seller\.(email|phone|tax_id|address_line|city|state|postal_code)$/)
      expect(field).not.toMatch(/^\*?seller\.reviews\.customer$/)
      expect(field).not.toMatch(/customer\.(email|phone)$/)
    }
  })
})

describe("pricingContext", () => {
  it("sends the region and country when the fields ask for prices", () => {
    expect(asksForPrices(PRODUCT_PAGE_FIELDS)).toBe(true)
    expect(asksForPrices(PRODUCT_LIST_FIELDS)).toBe(true)
    expect(pricingContext("*variants.calculated_price", "reg_us", "us")).toEqual({
      region_id: "reg_us",
      country_code: "us",
    })
  })

  it("sends neither when they do not, so no prices are calculated unasked", () => {
    expect(pricingContext("id,title,handle", "reg_us", "us")).toEqual({})
  })
})

describe("productPageQuery", () => {
  it("asks for one product by handle, with the page's fields, in the visitor's region", () => {
    expect(productPageQuery({ handle: "heirloom-tomatoes", regionId: "reg_us", countryCode: "us" })).toEqual({
      handle: ["heirloom-tomatoes"],
      limit: 1,
      offset: 0,
      region_id: "reg_us",
      country_code: "us",
      fields: PRODUCT_PAGE_FIELDS,
    })
  })
})

describe("productListQuery", () => {
  it("defaults to the card's fields and carries the region", () => {
    expect(
      productListQuery({ regionId: "reg_us", countryCode: "us", limit: 12, offset: 24, categoryId: "pcat_1" })
    ).toEqual({
      category_id: "pcat_1",
      collection_id: undefined,
      limit: 12,
      offset: 24,
      region_id: "reg_us",
      country_code: "us",
      fields: PRODUCT_LIST_FIELDS,
    })
  })

  it("keeps a caller's own fields, and its region only if they ask for prices", () => {
    expect(productListQuery({ fields: "id,title,handle", regionId: "reg_us", countryCode: "us", limit: 8, offset: 0 })).toEqual({
      category_id: undefined,
      collection_id: undefined,
      limit: 8,
      offset: 0,
      fields: "id,title,handle",
    })
  })
})
