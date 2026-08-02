import { logger } from "@/lib/logger"
import { sdk } from "@/lib/config"
import { HttpTypes } from "@medusajs/types"

interface CategoriesProps {
  query?: Record<string, any>
  headingCategories?: string[]
}

export const listCategories = async ({
  query,
  headingCategories = [],
}: Partial<CategoriesProps> = {}) => {
  const limit = query?.limit || 100

  // Fail soft like listProductTypes/listSalesChannels: a transient category
  // fetch failure must not take down every listing page that renders the
  // sidebar (it sits inside a Promise.all on those pages).
  let categories: HttpTypes.StoreProductCategory[]
  try {
    categories = await sdk.client
      .fetch<{
        product_categories: HttpTypes.StoreProductCategory[]
      }>("/store/product-categories", {
        query: {
          fields: "handle, name, rank, parent_category_id",
          limit,
          ...query,
        },
        cache: "force-cache",
        next: { revalidate: 3600 },
      })
      .then(({ product_categories }) => product_categories)
  } catch (error) {
    logger.error("Failed to fetch product categories:", error)
    return { categories: [], parentCategories: [] }
  }

  const parentCategories = categories.filter(({ name }) =>
    headingCategories.includes(name.toLowerCase())
  )

  const childrenCategories = categories.filter(
    ({ name }) => !headingCategories.includes(name.toLowerCase())
  )

  return {
    categories: childrenCategories.filter(
      ({ parent_category_id }) => !parent_category_id
    ),
    parentCategories: parentCategories,
  }
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  const handle = `${categoryHandle.join("/")}`

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          fields: "*category_children",
          handle,
        },
        cache: "force-cache",
        next: { revalidate: 300 },
      }
    )
    .then(({ product_categories }) => product_categories[0])
}

/**
 * List all product collections
 */
export const listCollections = async (limit = 50) => {
  return sdk.client
    .fetch<{
      collections: HttpTypes.StoreCollection[]
      count: number
    }>("/store/collections", {
      query: {
        limit,
        fields: "id,title,handle,metadata",
      },
      cache: "force-cache",
      next: { revalidate: 3600 },
    })
    .then(({ collections }) => collections)
}

/**
 * Get a single collection by handle
 */
export const getCollectionByHandle = async (handle: string) => {
  return sdk.client
    .fetch<{
      collections: HttpTypes.StoreCollection[]
    }>("/store/collections", {
      query: {
        handle,
        fields: "id,title,handle,metadata",
      },
      cache: "force-cache",
      next: { revalidate: 300 },
    })
    .then(({ collections }) => collections?.[0] || null)
}

export const listProductTypes = async () => {
  try {
    return await sdk.client
      .fetch<{ product_types: { id: string; value: string }[] }>(
        "/store/product-types",
        {
          query: { limit: 100, fields: "id,value" },
          cache: "force-cache",
          next: { revalidate: 3600 },
        }
      )
      .then(({ product_types }) => product_types)
  } catch {
    return []
  }
}

export const listSalesChannels = async () => {
  try {
    return await sdk.client
      .fetch<{ sales_channels: { id: string; name: string }[] }>(
        "/store/sales-channels",
        {
          query: { limit: 100, fields: "id,name" },
          cache: "force-cache",
          next: { revalidate: 3600 },
        }
      )
      .then(({ sales_channels }) => sales_channels)
  } catch {
    return []
  }
}

export const listFeaturedCategories = async (limit = 10) => {
  try {
    const { categories } = await listCategories({ query: { limit } })
    return categories
  } catch (error) {
    logger.error("Failed to fetch featured categories:", error)
    return []
  }
}
