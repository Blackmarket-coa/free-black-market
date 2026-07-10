import type { WooProduct, WooVariation } from "../types"

/**
 * Reduce an HTML fragment to plain text for a product description.
 *
 * Deliberately uses NO tag-specific regexes (e.g. `<script>…</script>`), which
 * are incomplete and bypassable (`<scr<script>ipt>`). Instead it decodes
 * entities, then strips every `<…>` in a loop until the string is stable, and
 * removes any residual angle bracket — so no markup (in particular `<script`)
 * can survive. Product descriptions are plain text; no markup is intended.
 */
function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ""

  // Decode entities first (&amp; LAST so "&amp;lt;" isn't double-unescaped into
  // "<"), so any encoded tags become real tags the strip below removes.
  let text = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

  // Strip all tags, looping until stable so nested/overlapping tags can't
  // reconstruct markup, then drop any leftover angle bracket.
  let prev: string
  do {
    prev = text
    text = text.replace(/<[^>]*>/g, " ")
  } while (text !== prev)
  text = text.replace(/[<>]/g, " ")

  return text.replace(/\s+/g, " ").trim()
}

function generateHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0
  const parsed = parseFloat(priceStr)
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100) // Convert to cents
}

function parseWeight(weightStr: string | null | undefined): number | null {
  if (!weightStr) return null
  const parsed = parseFloat(weightStr)
  if (isNaN(parsed)) return null
  // WooCommerce weight is in store's unit; assume kg, convert to grams
  return Math.round(parsed * 1000)
}

function parseDimension(dimStr: string | null | undefined): number | null {
  if (!dimStr) return null
  const parsed = parseFloat(dimStr)
  if (isNaN(parsed)) return null
  return parsed
}

function mapStatus(wooStatus: string): string {
  const statusMap: Record<string, string> = {
    publish: "published",
    draft: "draft",
    pending: "draft",
    private: "draft",
  }
  return statusMap[wooStatus] || "draft"
}

export interface TransformedProduct {
  title: string
  subtitle: string | null
  description: string
  handle: string
  status: string
  is_giftcard: boolean
  discountable: boolean
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
  images: Array<{ url: string }>
  tags: Array<{ value: string }>
  options: Array<{
    title: string
    values: string[]
  }>
  variants: TransformedVariant[]
  metadata: Record<string, any>
}

export interface TransformedVariant {
  title: string
  sku: string
  manage_inventory: boolean
  inventory_quantity: number
  allow_backorder: boolean
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
  prices: Array<{
    amount: number
    currency_code: string
  }>
  options: Record<string, string>
  metadata: Record<string, any>
}

export class WooToMedusaTransformer {
  private currency: string
  private sellerId: string

  constructor(currency = "usd", sellerId = "") {
    this.currency = currency.toLowerCase()
    this.sellerId = sellerId
  }

  /**
   * Fallback SKU for a Woo product/variation that has no SKU of its own.
   * Namespaced by seller so two vendors importing different stores that happen
   * to share a Woo product id don't collide on Medusa's unique variant SKU (and
   * so inventory sync can't cross tenants).
   */
  private fallbackSku(wooProductId: number, variationId?: number): string {
    const seller = this.sellerId ? `${this.sellerId}-` : ""
    const suffix = variationId != null ? `-${variationId}` : ""
    return `woo-${seller}${wooProductId}${suffix}`
  }

  /**
   * Transform a WooCommerce product into a Medusa-compatible product input.
   */
  transformProduct(
    wooProduct: WooProduct,
    wooVariations?: WooVariation[],
    importAsDraft = true
  ): TransformedProduct {
    const status = importAsDraft ? "draft" : mapStatus(wooProduct.status)

    // A "variable" product is only treated as multi-variant when we actually
    // have its variations. If the variation fetch failed/returned nothing we
    // import it as a single simple product (no options) so the create payload
    // stays valid — options with no matching variant make Medusa reject it.
    const usableVariations =
      wooProduct.type === "variable" &&
      wooVariations &&
      wooVariations.length > 0
        ? wooVariations
        : undefined

    const variants = this.transformVariants(wooProduct, usableVariations)
    const options = usableVariations
      ? this.buildOptions(wooProduct, variants)
      : []

    return {
      title: wooProduct.name,
      subtitle: wooProduct.short_description
        ? sanitizeHtml(wooProduct.short_description).substring(0, 255)
        : null,
      description: sanitizeHtml(wooProduct.description),
      handle: wooProduct.slug || generateHandle(wooProduct.name),
      status,
      is_giftcard: false,
      discountable: true,
      weight: parseWeight(wooProduct.weight),
      length: parseDimension(wooProduct.dimensions?.length),
      width: parseDimension(wooProduct.dimensions?.width),
      height: parseDimension(wooProduct.dimensions?.height),
      images: this.transformImages(wooProduct.images),
      tags: (wooProduct.tags || []).map((tag) => ({ value: tag.name })),
      options,
      variants,
      metadata: {
        woo_product_id: String(wooProduct.id),
        woo_permalink: wooProduct.permalink || null,
        woo_last_synced: new Date().toISOString(),
        woo_date_modified: wooProduct.date_modified || null,
        offering_type: "general",
        original_categories: JSON.stringify(wooProduct.categories || []),
      },
    }
  }

  private transformImages(
    wooImages: WooProduct["images"]
  ): Array<{ url: string }> {
    if (!wooImages || wooImages.length === 0) return []
    return wooImages.map((img) => ({ url: img.src }))
  }

  /**
   * Build product options for a variable product, unioning the attribute's
   * declared values with the values actually used by the transformed variants.
   * This keeps the option/variant sets consistent even for Woo "Any" variations
   * (whose option is an empty string, normalized here to "Any") so Medusa
   * accepts the product.
   */
  private buildOptions(
    wooProduct: WooProduct,
    variants: TransformedVariant[]
  ): Array<{ title: string; values: string[] }> {
    return (wooProduct.attributes || [])
      .filter((attr) => attr.variation)
      .map((attr) => {
        const values = new Set<string>()
        for (const value of attr.options || []) {
          values.add(value && value.trim() ? value : "Any")
        }
        for (const variant of variants) {
          const used = variant.options[attr.name]
          if (used) values.add(used)
        }
        if (values.size === 0) values.add("Any")
        return { title: attr.name, values: Array.from(values) }
      })
  }

  private transformVariants(
    wooProduct: WooProduct,
    wooVariations?: WooVariation[]
  ): TransformedVariant[] {
    // Simple product -> single variant
    if (wooProduct.type === "simple") {
      return [
        {
          title: "Default",
          sku: wooProduct.sku || this.fallbackSku(wooProduct.id),
          manage_inventory: wooProduct.manage_stock,
          inventory_quantity: wooProduct.stock_quantity ?? 0,
          allow_backorder: wooProduct.backorders_allowed,
          weight: parseWeight(wooProduct.weight),
          length: parseDimension(wooProduct.dimensions?.length),
          width: parseDimension(wooProduct.dimensions?.width),
          height: parseDimension(wooProduct.dimensions?.height),
          prices: [
            {
              amount: parsePrice(wooProduct.price || wooProduct.regular_price),
              currency_code: this.currency,
            },
          ],
          options: {},
          metadata: {
            woo_variant_id: String(wooProduct.id),
            woo_regular_price: wooProduct.regular_price || null,
            woo_sale_price: wooProduct.sale_price || null,
          },
        },
      ]
    }

    // Variable product -> multiple variants from variations
    if (wooProduct.type === "variable" && wooVariations && wooVariations.length > 0) {
      return wooVariations.map((variation) => {
        const optionMap: Record<string, string> = {}
        for (const attr of variation.attributes) {
          // Woo "Any <attr>" variations carry an empty option; normalize so the
          // value is present in the option list built by buildOptions().
          optionMap[attr.name] =
            attr.option && attr.option.trim() ? attr.option : "Any"
        }

        return {
          title: this.generateVariantTitle(variation.attributes),
          sku: variation.sku || this.fallbackSku(wooProduct.id, variation.id),
          manage_inventory: variation.manage_stock ?? wooProduct.manage_stock,
          inventory_quantity: variation.stock_quantity ?? 0,
          allow_backorder: variation.backorders_allowed ?? wooProduct.backorders_allowed,
          weight: parseWeight(variation.weight || wooProduct.weight),
          length: parseDimension(variation.dimensions?.length || wooProduct.dimensions?.length),
          width: parseDimension(variation.dimensions?.width || wooProduct.dimensions?.width),
          height: parseDimension(variation.dimensions?.height || wooProduct.dimensions?.height),
          prices: [
            {
              amount: parsePrice(variation.price || variation.regular_price),
              currency_code: this.currency,
            },
          ],
          options: optionMap,
          metadata: {
            woo_variant_id: String(variation.id),
            woo_regular_price: variation.regular_price || null,
            woo_sale_price: variation.sale_price || null,
          },
        }
      })
    }

    // Variable product with no variations fetched yet - create a placeholder
    return [
      {
        title: "Default",
        sku: wooProduct.sku || this.fallbackSku(wooProduct.id),
        manage_inventory: wooProduct.manage_stock,
        inventory_quantity: wooProduct.stock_quantity ?? 0,
        allow_backorder: wooProduct.backorders_allowed,
        weight: parseWeight(wooProduct.weight),
        length: parseDimension(wooProduct.dimensions?.length),
        width: parseDimension(wooProduct.dimensions?.width),
        height: parseDimension(wooProduct.dimensions?.height),
        prices: [
          {
            amount: parsePrice(wooProduct.price || wooProduct.regular_price),
            currency_code: this.currency,
          },
        ],
        options: {},
        metadata: {
          woo_variant_id: String(wooProduct.id),
          woo_regular_price: wooProduct.regular_price || null,
          woo_sale_price: wooProduct.sale_price || null,
        },
      },
    ]
  }

  private generateVariantTitle(
    attributes: WooVariation["attributes"]
  ): string {
    if (!attributes || attributes.length === 0) return "Default"
    return attributes.map((attr) => attr.option).join(" / ")
  }
}
