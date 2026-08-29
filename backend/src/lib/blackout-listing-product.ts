import { createLogger } from "../shared/logger"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { MARKETPLACE_LISTING_MODULE } from "../modules/marketplace-listing"

const log = createLogger("lib/blackout-listing-product")

/**
 * Shadow-product bridge for the Blackout checkout (W1b).
 *
 * A priced `creator_listing` can only enter a Medusa cart through a product
 * variant, so the first checkout of a listing lazily materializes a
 * product+variant priced from `price_cents`/`currency` and persists the ids
 * back onto the listing. Subsequent checkouts reuse them.
 *
 * Uniqueness anchor: the product `handle` is derived deterministically from
 * the listing id (unique column on `product`), so a concurrent first-checkout
 * race collapses to one product — the loser's insert fails the unique
 * constraint and re-reads the winner's row.
 */

export interface ListingForProduct {
  id: string
  seller_id: string
  title: string
  description?: string | null
  price_cents?: number | null
  currency?: string | null
  product_id?: string | null
  variant_id?: string | null
  media_urls?: unknown
}

export interface EnsuredListingProduct {
  product_id: string
  variant_id: string
  created: boolean
}

/** Deterministic, handle-safe identifier for a listing's shadow product. */
export function listingProductHandle(listingId: string): string {
  const safe = listingId.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  return `blackout-listing-${safe}`.slice(0, 128)
}

type ProductWithVariants = {
  id: string
  variants?: Array<{ id: string }>
}

type ProductServiceLike = {
  listProducts: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<ProductWithVariants[]>
}

type ListingServiceLike = {
  updateCreatorListings: (data: Record<string, unknown>) => Promise<unknown>
}

async function findByHandle(
  container: MedusaContainer,
  handle: string
): Promise<ProductWithVariants | null> {
  const productService = container.resolve(
    Modules.PRODUCT
  ) as unknown as ProductServiceLike
  const found = await productService.listProducts(
    { handle },
    { relations: ["variants"], take: 1 }
  )
  return found[0] ?? null
}

async function defaultSalesChannelId(
  container: MedusaContainer
): Promise<string | null> {
  try {
    const storeService = container.resolve(Modules.STORE) as unknown as {
      listStores: (
        f?: Record<string, unknown>,
        c?: Record<string, unknown>
      ) => Promise<Array<{ default_sales_channel_id?: string | null }>>
    }
    const [store] = await storeService.listStores({}, { take: 1 })
    if (store?.default_sales_channel_id) return store.default_sales_channel_id
  } catch {
    // fall through to sales-channel lookup
  }
  try {
    const scService = container.resolve(Modules.SALES_CHANNEL) as unknown as {
      listSalesChannels: (
        f?: Record<string, unknown>,
        c?: Record<string, unknown>
      ) => Promise<Array<{ id: string }>>
    }
    const [channel] = await scService.listSalesChannels({}, { take: 1 })
    return channel?.id ?? null
  } catch {
    return null
  }
}

function firstHttpsUrl(mediaUrls: unknown): string | undefined {
  if (!Array.isArray(mediaUrls)) return undefined
  const url = mediaUrls.find(
    (u) => typeof u === "string" && u.startsWith("https://")
  )
  return typeof url === "string" ? url : undefined
}

async function persistOnListing(
  container: MedusaContainer,
  listingId: string,
  productId: string,
  variantId: string
): Promise<void> {
  const listingService = container.resolve(
    MARKETPLACE_LISTING_MODULE
  ) as unknown as ListingServiceLike
  await listingService.updateCreatorListings({
    id: listingId,
    product_id: productId,
    variant_id: variantId,
  })
}

async function linkSeller(
  container: MedusaContainer,
  sellerId: string,
  productId: string
): Promise<void> {
  try {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    await remoteLink.create({
      [SELLER_MODULE]: { seller_id: sellerId },
      [Modules.PRODUCT]: { product_id: productId },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("already exists") && !message.includes("duplicate")) {
      log.warn(
        `Could not link shadow product ${productId} to seller ${sellerId}: ${message}`
      )
    }
  }
}

/**
 * Ensure the listing has a purchasable product+variant; returns their ids.
 *
 * Throws when the listing carries no usable price (`price_cents`/`currency`)
 * — such listings are catalog-only and must never reach checkout.
 */
export async function ensureListingProduct(
  container: MedusaContainer,
  listing: ListingForProduct
): Promise<EnsuredListingProduct> {
  if (listing.product_id && listing.variant_id) {
    return {
      product_id: listing.product_id,
      variant_id: listing.variant_id,
      created: false,
    }
  }

  if (
    typeof listing.price_cents !== "number" ||
    listing.price_cents < 0 ||
    !listing.currency
  ) {
    throw new Error(
      `Listing ${listing.id} has no price_cents/currency; cannot create a checkout product`
    )
  }

  const handle = listingProductHandle(listing.id)
  const currencyCode = listing.currency.toLowerCase()
  // Medusa v2 price amounts are major units (e.g. 5 == $5.00), the listing
  // catalog is integer cents.
  const amount = listing.price_cents / 100

  // A previous run may have created the product but died before writing the
  // ids back to the listing — the deterministic handle recovers it.
  const existing = await findByHandle(container, handle)
  if (existing) {
    const variantId = existing.variants?.[0]?.id
    if (!variantId) {
      throw new Error(
        `Shadow product ${existing.id} for listing ${listing.id} has no variant`
      )
    }
    await persistOnListing(container, listing.id, existing.id, variantId)
    return { product_id: existing.id, variant_id: variantId, created: false }
  }

  const salesChannelId = await defaultSalesChannelId(container)
  const thumbnail = firstHttpsUrl(listing.media_urls)

  const productInput = {
    title: listing.title,
    handle,
    description: listing.description ?? undefined,
    status: ProductStatus.PUBLISHED,
    discountable: false,
    thumbnail,
    metadata: {
      creator_listing_id: listing.id,
      blackout_shadow_product: true,
    },
    options: [{ title: "Default", values: ["Default"] }],
    variants: [
      {
        title: listing.title.slice(0, 255),
        // Digital/entitlement goods: no stock, no fulfillment inventory.
        manage_inventory: false,
        prices: [{ amount, currency_code: currencyCode }],
        options: { Default: "Default" },
      },
    ],
    ...(salesChannelId ? { sales_channels: [{ id: salesChannelId }] } : {}),
  }

  let product: ProductWithVariants | null = null
  try {
    const { result } = await createProductsWorkflow(container).run({
      input: { products: [productInput] },
    })
    product = (result?.[0] as ProductWithVariants | undefined) ?? null
  } catch (error) {
    // Unique-handle race: another request created it first — reuse theirs.
    const recovered = await findByHandle(container, handle)
    if (!recovered) throw error
    product = recovered
  }

  const variantId = product?.variants?.[0]?.id
  if (!product || !variantId) {
    throw new Error(
      `Failed to materialize checkout product for listing ${listing.id}`
    )
  }

  await linkSeller(container, listing.seller_id, product.id)
  await persistOnListing(container, listing.id, product.id, variantId)

  return { product_id: product.id, variant_id: variantId, created: true }
}
