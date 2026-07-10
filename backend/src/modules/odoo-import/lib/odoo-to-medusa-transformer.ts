import type { OdooProduct } from "../types"

function sanitize(html: string | false | undefined | null): string {
  if (!html) return ""
  return (
    html
      // Decode entities with &amp; LAST so "&amp;lt;" can't be double-unescaped
      // into "<"; then strip tags once more to remove any markup the decode
      // revealed. (CodeQL: double unescaping.)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export interface OdooTransformedProduct {
  title: string
  subtitle: string | null
  description: string
  handle: string
  status: string
  images: Array<{ url: string }>
  tags: Array<{ value: string }>
  options: Array<{ title: string; values: string[] }>
  variants: Array<{
    title: string
    sku: string
    manage_inventory: boolean
    allow_backorder: boolean
    prices: Array<{ amount: number; currency_code: string }>
    options: Record<string, string>
    metadata: Record<string, unknown>
  }>
  metadata: Record<string, unknown>
}

/**
 * Transform an Odoo product.template into a Medusa create payload. v1 imports
 * each template as a single simple product (no variant explosion) — Odoo is a
 * read-only data source; checkout/inventory stay in FBM.
 */
export class OdooToMedusaTransformer {
  private currency: string
  private sellerId: string

  constructor(currency = "usd", sellerId = "") {
    this.currency = currency.toLowerCase()
    this.sellerId = sellerId
  }

  private fallbackSku(odooId: number): string {
    const seller = this.sellerId ? `${this.sellerId}-` : ""
    return `odoo-${seller}${odooId}`
  }

  transformProduct(
    product: OdooProduct,
    importAsDraft = true
  ): OdooTransformedProduct {
    const title = product.name || product.display_name || `Odoo product ${product.id}`
    const sku =
      (typeof product.default_code === "string" && product.default_code) ||
      this.fallbackSku(product.id)
    const currency =
      (Array.isArray(product.currency_id) && product.currency_id[1]
        ? String(product.currency_id[1])
        : this.currency
      ).toLowerCase()
    const amount = Math.round((Number(product.list_price) || 0) * 100)

    return {
      title,
      subtitle: null,
      description: sanitize(product.description_sale) || sanitize(product.description),
      handle: `odoo-${slugify(title) || product.id}`,
      status: importAsDraft ? "draft" : product.is_published ? "published" : "draft",
      // Odoo images arrive as base64 (image_1920), not URLs — skip for v1 rather
      // than persist multi-MB data URIs.
      images: [],
      tags: [],
      options: [],
      variants: [
        {
          title: "Default",
          sku,
          manage_inventory: false,
          allow_backorder: true,
          prices: [{ amount, currency_code: currency }],
          options: {},
          metadata: {
            odoo_barcode:
              typeof product.barcode === "string" ? product.barcode : null,
          },
        },
      ],
      metadata: {
        odoo_product_id: String(product.id),
        odoo_last_synced: new Date().toISOString(),
        offering_type: "general",
      },
    }
  }
}
