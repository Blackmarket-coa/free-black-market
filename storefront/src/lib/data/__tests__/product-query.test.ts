import { describe, expect, it } from "vitest"

import {
  MORE_FROM_SELLER_CANDIDATES,
  PRODUCT_FEED_FIELDS,
  PRODUCT_LIST_FIELDS,
  PRODUCT_PAGE_FIELDS,
  PRODUCT_PAGE_FIELDS_WITHOUT_STOCK,
  asksForPrices,
  moreFromSellerHandles,
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
    ["the handles to ask the listing for (more from this seller)", "seller.products.handle"],
    ["what tells a draft from a published product among them", "seller.products.status"],
    ["additional attributes", "attribute_values.attribute.name"],
  ])("asks for %s", (_what, field) => {
    expect(fieldsOf(PRODUCT_PAGE_FIELDS)).toContain(field)
  })

  it("is not the five scalar fields the workaround sent", () => {
    expect(PRODUCT_PAGE_FIELDS).not.toBe("id,title,handle,thumbnail,status")
  })

  it("asks the seller's product link for candidates only, nothing to render", () => {
    // The link returns drafts and other sales channels' products too; their
    // titles and thumbnails are not asked for, and the cards are rendered
    // from what the listing serves.
    expect(fieldsOf(PRODUCT_PAGE_FIELDS).filter((field) => field.startsWith("seller.products")).sort()).toEqual([
      "seller.products.handle",
      "seller.products.id",
      "seller.products.status",
    ])
    expect(PRODUCT_PAGE_FIELDS).not.toMatch(/\*seller\.products/)
  })
})

describe("PRODUCT_PAGE_FIELDS_WITHOUT_STOCK", () => {
  it("is the page's fields without the stock count, and nothing else removed", () => {
    expect(fieldsOf(PRODUCT_PAGE_FIELDS)).toContain("variants.inventory_quantity")
    expect(fieldsOf(PRODUCT_PAGE_FIELDS_WITHOUT_STOCK)).toEqual(
      fieldsOf(PRODUCT_PAGE_FIELDS).filter((field) => field !== "variants.inventory_quantity")
    )
    expect(PRODUCT_PAGE_FIELDS_WITHOUT_STOCK).not.toContain("inventory_quantity")
    expect(asksForPrices(PRODUCT_PAGE_FIELDS_WITHOUT_STOCK)).toBe(true)
  })
})

describe("PRODUCT_FEED_FIELDS", () => {
  it("is a card's fields with what a feed item also shows", () => {
    expect(fieldsOf(PRODUCT_FEED_FIELDS)).toEqual([...fieldsOf(PRODUCT_LIST_FIELDS), "description", "seller.photo"])
  })

  it("is not what a grid is sent", () => {
    expect(fieldsOf(PRODUCT_LIST_FIELDS)).not.toContain("description")
    expect(fieldsOf(PRODUCT_LIST_FIELDS)).not.toContain("seller.photo")
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
    ["page without stock", PRODUCT_PAGE_FIELDS_WITHOUT_STOCK],
    ["list", PRODUCT_LIST_FIELDS],
    ["feed", PRODUCT_FEED_FIELDS],
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

describe("productPageQuery without the stock count", () => {
  it("asks for the same product in the same region, leaving only the count out", () => {
    expect(
      productPageQuery({ handle: "heirloom-tomatoes", regionId: "reg_us", countryCode: "us", stock: false })
    ).toEqual({
      handle: ["heirloom-tomatoes"],
      limit: 1,
      offset: 0,
      region_id: "reg_us",
      country_code: "us",
      fields: PRODUCT_PAGE_FIELDS_WITHOUT_STOCK,
    })
  })
})

describe("moreFromSellerHandles", () => {
  const stub = (handle: string, status = "published") => ({ id: `prod_${handle}`, handle, status })

  it("names the seller's other published products", () => {
    // The seller's link as the backend returned it in the integration spec:
    // the product itself, a draft and a wholesale-only product among them.
    const product = {
      id: "prod_heirloom-tomatoes",
      seller: {
        products: [
          stub("sweet-corn"),
          stub("wholesale-pallet"),
          stub("basil"),
          stub("heirloom-tomatoes"),
          stub("unreleased-hot-sauce", "draft"),
        ],
      },
    }
    // The wholesale-only product is published, so it is still a candidate:
    // the listing is what leaves it out.
    expect(moreFromSellerHandles(product)).toEqual(["sweet-corn", "wholesale-pallet", "basil"])
  })

  it("leaves out anything not published, or with no status to go by", () => {
    const product = {
      id: "prod_x",
      seller: {
        products: [
          stub("a", "draft"),
          stub("b", "proposed"),
          stub("c", "rejected"),
          { id: "prod_d", handle: "d" },
          { id: "prod_e", handle: "e", status: null },
          null,
          { id: "prod_f", status: "published" },
          stub("g"),
        ],
      },
    }
    expect(moreFromSellerHandles(product)).toEqual(["g"])
  })

  it("asks for a few more than are shown, and no more", () => {
    const many = Array.from({ length: 30 }, (_, i) => stub(`p${i}`))
    const handles = moreFromSellerHandles({ id: "prod_p0", seller: { products: many } })
    expect(handles).toHaveLength(MORE_FROM_SELLER_CANDIDATES)
    expect(handles).not.toContain("p0")
    expect(handles[0]).toBe("p1")
  })

  it("is empty for a product with no seller or no linked products", () => {
    expect(moreFromSellerHandles({ id: "prod_x" })).toEqual([])
    expect(moreFromSellerHandles({ id: "prod_x", seller: null })).toEqual([])
    expect(moreFromSellerHandles({ id: "prod_x", seller: {} })).toEqual([])
    expect(moreFromSellerHandles({ id: "prod_x", seller: { products: null } })).toEqual([])
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
