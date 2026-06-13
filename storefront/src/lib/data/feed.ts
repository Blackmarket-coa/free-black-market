"use server"
import { logger } from "@/lib/logger"

import { listProducts } from "./products"
import { HttpTypes } from "@medusajs/types"
import { SellerProps } from "@/types/seller"

export type FeedMode = "trending" | "recent" | "featured" | "personalized" | "following"

interface FeedOptions {
  mode?: FeedMode
  countryCode: string
  page?: number
  limit?: number
  categoryId?: string
  sellerId?: string
}

interface FeedResponse {
  products: (HttpTypes.StoreProduct & { seller?: SellerProps })[]
  nextPage: number | null
  totalCount: number
}

/**
 * Get products for the feed based on the mode
 */
export async function getProductFeed({
  mode = "trending",
  countryCode,
  page = 1,
  limit = 12,
  categoryId,
  sellerId,
}: FeedOptions): Promise<FeedResponse> {
  // Determine sort order based on mode
  const getSortOrder = (feedMode: FeedMode): string => {
    switch (feedMode) {
      case "trending":
        return "-created_at" // Most recent as proxy for trending
      case "recent":
        return "-created_at"
      case "featured":
        return "-created_at" // Could be curated in future
      case "personalized":
        return "-created_at" // Could use recommendation engine
      case "following":
        return "-created_at"
      default:
        return "-created_at"
    }
  }

  try {
    const { response, nextPage } = await listProducts({
      pageParam: page,
      countryCode,
      category_id: categoryId,
      queryParams: {
        limit,
        order: getSortOrder(mode),
      },
      forceCache: mode === "trending" || mode === "featured",
    })

    // Filter by seller if provided (for "following" mode)
    let products = response.products
    if (sellerId) {
      products = products.filter((p) => p.seller?.id === sellerId)
    }

    return {
      products,
      nextPage,
      totalCount: response.count,
    }
  } catch (error) {
    logger.error("Error fetching product feed:", error)
    return {
      products: [],
      nextPage: null,
      totalCount: 0,
    }
  }
}

/**
 * Get trending products for the home page
 */
export async function getTrendingProducts(
  countryCode: string,
  limit: number = 8
): Promise<(HttpTypes.StoreProduct & { seller?: SellerProps })[]> {
  const { products } = await getProductFeed({
    mode: "trending",
    countryCode,
    limit,
  })
  return products
}

/**
 * Get recently added products
 */
export async function getRecentProducts(
  countryCode: string,
  limit: number = 12
): Promise<(HttpTypes.StoreProduct & { seller?: SellerProps })[]> {
  const { products } = await getProductFeed({
    mode: "recent",
    countryCode,
    limit,
  })
  return products
}

/**
 * Get featured products (curated picks)
 */
export async function getFeaturedProducts(
  countryCode: string,
  limit: number = 8
): Promise<(HttpTypes.StoreProduct & { seller?: SellerProps })[]> {
  const { products } = await getProductFeed({
    mode: "featured",
    countryCode,
    limit,
  })
  return products
}

/**
 * Get products from sellers the user follows
 */
export async function getFollowingFeed(
  countryCode: string,
  followedSellerIds: string[],
  limit: number = 12
): Promise<(HttpTypes.StoreProduct & { seller?: SellerProps })[]> {
  if (!followedSellerIds.length) return []

  // Fetch products from all followed sellers
  const allProducts: (HttpTypes.StoreProduct & { seller?: SellerProps })[] = []

  for (const sellerId of followedSellerIds.slice(0, 5)) {
    const { products } = await getProductFeed({
      mode: "following",
      countryCode,
      sellerId,
      limit: Math.ceil(limit / followedSellerIds.length),
    })
    allProducts.push(...products)
  }

  // Sort by created_at and limit
  return allProducts
    .sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
    .slice(0, limit)
}
