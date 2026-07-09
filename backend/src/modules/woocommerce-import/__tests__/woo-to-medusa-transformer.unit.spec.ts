import { WooToMedusaTransformer } from "../lib/woo-to-medusa-transformer"
import type { WooProduct, WooVariation } from "../types"

const baseProduct = (over: Partial<WooProduct> = {}): WooProduct =>
  ({
    id: 5,
    name: "Widget",
    slug: "widget",
    permalink: "https://store.example/widget",
    date_created: "",
    date_modified: "",
    type: "simple",
    status: "publish",
    featured: false,
    description: "<p>A widget</p>",
    short_description: "Short",
    sku: "",
    price: "10.00",
    regular_price: "10.00",
    sale_price: "",
    on_sale: false,
    manage_stock: true,
    stock_quantity: 3,
    stock_status: "instock",
    backorders: "no",
    backorders_allowed: false,
    weight: "1",
    dimensions: { length: "", width: "", height: "" },
    images: [],
    categories: [],
    tags: [],
    attributes: [],
    variations: [],
    meta_data: [],
    ...over,
  }) as WooProduct

describe("WooToMedusaTransformer fallback SKUs (B4)", () => {
  it("namespaces fallback SKUs by seller so two vendors don't collide", () => {
    const a = new WooToMedusaTransformer("usd", "sel_A")
    const b = new WooToMedusaTransformer("usd", "sel_B")

    const skuA = a.transformProduct(baseProduct()).variants[0].sku
    const skuB = b.transformProduct(baseProduct()).variants[0].sku

    expect(skuA).toBe("woo-sel_A-5")
    expect(skuB).toBe("woo-sel_B-5")
    expect(skuA).not.toBe(skuB)
  })

  it("keeps an explicit Woo SKU untouched", () => {
    const t = new WooToMedusaTransformer("usd", "sel_A")
    const sku = t.transformProduct(baseProduct({ sku: "REAL-SKU" })).variants[0]
      .sku
    expect(sku).toBe("REAL-SKU")
  })
})

describe("WooToMedusaTransformer variable products (B6)", () => {
  it("imports a variable product with no fetched variations as a single simple product (no options)", () => {
    const t = new WooToMedusaTransformer("usd", "sel_A")
    const product = baseProduct({
      type: "variable",
      attributes: [
        {
          id: 1,
          name: "Size",
          position: 0,
          visible: true,
          variation: true,
          options: ["S", "M"],
        },
      ],
    })

    const out = t.transformProduct(product, undefined)
    expect(out.options).toEqual([])
    expect(out.variants).toHaveLength(1)
    expect(out.variants[0].options).toEqual({})
  })

  it("reconciles 'Any' variations so every variant value is a declared option value", () => {
    const t = new WooToMedusaTransformer("usd", "sel_A")
    const product = baseProduct({
      type: "variable",
      attributes: [
        {
          id: 1,
          name: "Size",
          position: 0,
          visible: true,
          variation: true,
          options: ["S", "M"],
        },
      ],
    })
    const variations: WooVariation[] = [
      {
        id: 51,
        sku: "",
        price: "10.00",
        regular_price: "10.00",
        sale_price: "",
        on_sale: false,
        stock_quantity: 2,
        stock_status: "instock",
        manage_stock: true,
        backorders_allowed: false,
        weight: "",
        dimensions: { length: "", width: "", height: "" },
        image: null,
        // "Any Size" variation → empty option string
        attributes: [{ id: 1, name: "Size", option: "" }],
      } as WooVariation,
    ]

    const out = t.transformProduct(product, variations)

    // Fallback SKU is seller+product+variation namespaced
    expect(out.variants[0].sku).toBe("woo-sel_A-5-51")
    // The empty option is normalized to "Any" on the variant...
    expect(out.variants[0].options.Size).toBe("Any")
    // ...and "Any" is present in the option's declared values
    const sizeOption = out.options.find((o) => o.title === "Size")
    expect(sizeOption?.values).toContain("Any")
  })
})
