"use server"

import { medusaFetch } from "../config"
import { sortProducts } from "@/lib/helpers/sort-products"
import { HttpTypes } from "@medusajs/types"
import { SortOptions } from "@/types/product"
import { getAuthHeaders } from "./cookies"
import { getRegion, retrieveRegion } from "./regions"
import { SellerProps } from "@/types/seller"
import { normalizeImageUrl } from "@/lib/helpers/normalize-image-url"

const normalizeProductImages = (product: HttpTypes.StoreProduct) => ({
  ...product,
  thumbnail: normalizeImageUrl(product.thumbnail),
  images:
    product.images?.map((image) => ({
      ...image,
      url: normalizeImageUrl(image.url),
    })) || [],
})

export const listProducts = async ({
  pageParam = 1,
  queryParams,
  countryCode,
  regionId,
  category_id,
  collection_id,
  forceCache = false,
}: {
  pageParam?: number
  queryParams?: HttpTypes.FindParams &
    HttpTypes.StoreProductParams & {
      handle?: string[]
    }
  category_id?: string
  collection_id?: string
  countryCode?: string
  regionId?: string
  forceCache?: boolean
}): Promise<{
  response: {
    products: (HttpTypes.StoreProduct & { seller?: SellerProps })[]
    count: number
  }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
}> => {
  if (!countryCode && !regionId) {
    throw new Error("Country code or region ID is required")
  }

  const limit = queryParams?.limit || 12
  const _pageParam = Math.max(pageParam, 1)
  const offset = (_pageParam - 1) * limit

  let region: HttpTypes.StoreRegion | undefined | null

  if (countryCode) {
    region = await getRegion(countryCode)
  } else {
    region = await retrieveRegion(regionId!)
  }

  if (!region) {
    return {
      response: { products: [], count: 0 },
      nextPage: null,
    }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const useCached = forceCache || (limit <= 8 && !category_id && !collection_id)

  return medusaFetch<{
    products: (HttpTypes.StoreProduct & { seller?: SellerProps })[]
    count: number
  }>(`/store/products`, {
    method: "GET",
    query: {
      category_id,
      collection_id,
      limit,
      offset,
      // region_id omitted — MikroORM ORM bug workaround
      fields: "id,title,handle,thumbnail,status", // ORM bug: *-expansions fail
      ...queryParams,
    },
    headers,
    next: useCached ? { revalidate: 60 } : undefined,
    cache: useCached ? "force-cache" : "no-cache",
  })
    .then(({ products: productsRaw, count }) => {
      // Only exclude products from suspended sellers
      const products = productsRaw.filter(
        (product) => product.seller?.store_status !== "SUSPENDED"
      )

      const response = products.map((prod) => {
        const normalizedProduct = normalizeProductImages(prod)

        if (!prod.seller) return normalizedProduct
        // @ts-ignore Property 'seller' exists but TypeScript doesn't recognize it
        const reviews = prod.seller?.reviews?.filter((item) => !!item) ?? []
        return {
          ...normalizedProduct,
          seller: {
            // @ts-ignore Property 'seller' exists but TypeScript doesn't recognize it
            ...prod.seller,
            reviews,
          },
        }
      })

      const filteredCount = count
      const nextPage = count > offset + limit ? pageParam + 1 : null

      return {
        response: {
          products: response,
          count: filteredCount,
        },
        nextPage: nextPage,
        queryParams,
      }
    })
    .catch(() => {
      return {
        response: {
          products: [],
          count: 0,
        },
        nextPage: 0,
        queryParams,
      }
    })
}

/**
 * Detail-path only: fetch the product's listing-type catalog id from the
 * dedicated read endpoint (the store products API does not expose the
 * listing-type link, and the list fetch's fields cannot be widened due to
 * the ORM-bug workaround above). Returns null on any failure so the
 * detail page can fall back to physical-product presentation.
 */
export const getProductListingType = async (
  productId: string
): Promise<string | null> => {
  if (!productId) return null

  try {
    const { catalog_id } = await medusaFetch<{ catalog_id: string | null }>(
      `/store/products/${productId}/listing-type`,
      {
        method: "GET",
        next: { revalidate: 60 },
        cache: "force-cache",
      }
    )
    return catalog_id ?? null
  } catch {
    return null
  }
}

/**
 * This will fetch 100 products to the Next.js cache and sort them based on the sortBy parameter.
 * It will then return the paginated products based on the page and limit parameters.
 */
export const listProductsWithSort = async ({
  page = 1,
  queryParams,
  sortBy = "created_at",
  countryCode,
  category_id,
  seller_id,
  collection_id,
}: {
  page?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
  sortBy?: SortOptions
  countryCode: string
  category_id?: string
  seller_id?: string
  collection_id?: string
}): Promise<{
  response: {
    products: HttpTypes.StoreProduct[]
    count: number
  }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
}> => {
  const limit = queryParams?.limit || 12

  const {
    response: { products, count },
  } = await listProducts({
    pageParam: 0,
    queryParams: {
      ...queryParams,
      limit: 100,
    },
    category_id,
    collection_id,
    countryCode,
  })

  const filteredProducts = seller_id
    ? products.filter((product) => product.seller?.id === seller_id)
    : products

  const sortedProducts = sortProducts(filteredProducts, sortBy)

  const totalCount = sortedProducts.length
  const pageParam = (page - 1) * limit

  const nextPage = totalCount > pageParam + limit ? pageParam + limit : null

  const paginatedProducts = sortedProducts.slice(pageParam, pageParam + limit)

  return {
    response: {
      products: paginatedProducts,
      count: totalCount,
    },
    nextPage,
    queryParams,
  }
}
