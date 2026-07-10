import { OdooToMedusaTransformer } from "../lib/odoo-to-medusa-transformer"
import type { OdooProduct } from "../types"

const base = (over: Partial<OdooProduct> = {}): OdooProduct => ({
  id: 7,
  name: "Widget",
  list_price: 12.5,
  description_sale: "<p>Nice</p>",
  is_published: true,
  ...over,
})

describe("OdooToMedusaTransformer", () => {
  it("namespaces fallback SKUs by seller", () => {
    const a = new OdooToMedusaTransformer("usd", "sel_A")
    const b = new OdooToMedusaTransformer("usd", "sel_B")
    expect(a.transformProduct(base()).variants[0].sku).toBe("odoo-sel_A-7")
    expect(b.transformProduct(base()).variants[0].sku).toBe("odoo-sel_B-7")
  })

  it("keeps an explicit default_code as the SKU", () => {
    const t = new OdooToMedusaTransformer("usd", "sel_A")
    expect(t.transformProduct(base({ default_code: "SKU-X" })).variants[0].sku).toBe("SKU-X")
  })

  it("converts list_price to minor units", () => {
    const t = new OdooToMedusaTransformer("usd", "sel_A")
    expect(t.transformProduct(base({ list_price: 12.5 })).variants[0].prices[0].amount).toBe(1250)
  })

  it("maps status from importAsDraft / is_published", () => {
    const t = new OdooToMedusaTransformer("usd", "sel_A")
    expect(t.transformProduct(base(), true).status).toBe("draft")
    expect(t.transformProduct(base({ is_published: true }), false).status).toBe("published")
    expect(t.transformProduct(base({ is_published: false }), false).status).toBe("draft")
  })

  it("prefers the Odoo product currency when present", () => {
    const t = new OdooToMedusaTransformer("usd", "sel_A")
    const out = t.transformProduct(base({ currency_id: [3, "GBP"] }), false)
    expect(out.variants[0].prices[0].currency_code).toBe("gbp")
  })

  it("stamps odoo_product_id metadata for idempotent re-import", () => {
    const t = new OdooToMedusaTransformer("usd", "sel_A")
    expect(t.transformProduct(base({ id: 42 })).metadata.odoo_product_id).toBe("42")
  })
})
