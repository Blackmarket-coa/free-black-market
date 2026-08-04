import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import type { ChannelProduct } from "../modules/channel-connector/types"

const log = createLogger("shared/channel-products")

/**
 * Read a seller's catalogue in the narrow shape the channel adapters take.
 *
 * The composition point. `channel-connector` cannot reach Medusa's product
 * graph, and the adapters must not learn Medusa's schema — an adapter that took
 * a `ProductDTO` would couple every future channel to whatever `query.graph`
 * happened to select at one call site. This is the one place that translation
 * from FBM's storage to `ChannelProduct` lives.
 *
 * Mirrors `api/vendor/products/route.ts` exactly in how it resolves a seller's
 * products — via the `seller_product` link — so what gets pushed to a channel
 * is the same set the vendor sees in their own product list. A sync that
 * pushed a different set than the panel shows would be impossible for a vendor
 * to reconcile.
 */

type MedusaVariant = {
  id?: string
  sku?: string | null
  weight?: number | null
  inventory_quantity?: number | null
  manage_inventory?: boolean
  prices?: { amount?: number; currency_code?: string }[]
}

type MedusaProduct = {
  id?: string
  title?: string
  description?: string | null
  status?: string
  thumbnail?: string | null
  images?: { url?: string }[]
  categories?: { name?: string }[]
  variants?: MedusaVariant[]
}

/**
 * Reduce a Medusa product to what a channel needs.
 *
 * Exported and pure so the reduction — which is where the awkward decisions
 * are — is testable without a container.
 *
 * **Takes the first variant.** Channels model a listing as one sellable thing
 * with one price and one SKU; Medusa models a product as many variants. A
 * faithful multi-variant mapping is real work and belongs with the channel
 * that needs it, but silently pushing only the first variant *without saying
 * so* would leave a vendor wondering where their other sizes went. So a
 * multi-variant product is reported rather than quietly flattened — see
 * `skipped_reason` on the result.
 */
export type ProductReduction =
  | { ok: true; product: ChannelProduct }
  | { ok: false; product_id: string; reason: string }

export function reduceToChannelProduct(raw: MedusaProduct): ProductReduction {
  const id = raw.id ?? ""
  if (!id) return { ok: false, product_id: "", reason: "Product has no id." }

  const variants = raw.variants ?? []
  if (variants.length === 0) {
    return { ok: false, product_id: id, reason: "Product has no variants to list." }
  }
  if (variants.length > 1) {
    return {
      ok: false,
      product_id: id,
      reason: `Product has ${variants.length} variants. Channels list a single sellable item, so multi-variant products are not synced yet rather than being flattened to their first variant.`,
    }
  }

  const variant = variants[0]
  const price = variant.prices?.[0]

  const images = [
    ...(raw.thumbnail ? [raw.thumbnail] : []),
    ...(raw.images ?? []).map((i) => i.url).filter((u): u is string => Boolean(u)),
  ]

  return {
    ok: true,
    product: {
      id,
      title: raw.title ?? "",
      description: raw.description ?? null,
      sku: variant.sku ?? null,
      price_amount: Math.max(0, Math.round(price?.amount ?? 0)),
      currency_code: price?.currency_code ?? "usd",
      // `manage_inventory: false` means Medusa is deliberately not counting —
      // which is exactly the `null` the mapper treats as "do not claim stock",
      // rather than the zero that would look like a deliberate sell-out.
      inventory_quantity: variant.manage_inventory
        ? (variant.inventory_quantity ?? 0)
        : null,
      images: [...new Set(images)],
      categories: (raw.categories ?? [])
        .map((c) => c.name)
        .filter((n): n is string => Boolean(n)),
      weight_grams: variant.weight ?? null,
      active: raw.status === "published",
    },
  }
}

/**
 * A seller's catalogue, reduced.
 *
 * Returns the failures alongside the successes rather than dropping them, so a
 * sync run can tell a vendor *which* products it could not push and why. A job
 * that silently syncs 12 of 20 products is the kind of thing that erodes trust
 * in an integration permanently.
 */
export async function loadSellerChannelProducts(
  container: MedusaContainer,
  sellerId: string
): Promise<{ products: ChannelProduct[]; skipped: { product_id: string; reason: string }[] }> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "seller_product",
      fields: [
        "product.id",
        "product.title",
        "product.description",
        "product.status",
        "product.thumbnail",
        "product.images.*",
        "product.categories.*",
        "product.variants.*",
        "product.variants.prices.*",
      ],
      filters: { seller_id: sellerId },
    })

    const products: ChannelProduct[] = []
    const skipped: { product_id: string; reason: string }[] = []

    for (const row of data ?? []) {
      const raw = (row as { product?: MedusaProduct }).product
      if (!raw) continue
      const reduced = reduceToChannelProduct(raw)
      if (reduced.ok) products.push(reduced.product)
      else skipped.push({ product_id: reduced.product_id, reason: reduced.reason })
    }

    return { products, skipped }
  } catch (err) {
    // A catalogue read failure yields nothing to push rather than throwing:
    // one seller's bad read must not abort a sync run for every other seller.
    log.warn(`[channel-products] catalogue read failed for ${sellerId}`, err)
    return { products: [], skipped: [] }
  }
}
