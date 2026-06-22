"use server"

import { HttpTypes } from "@medusajs/types"
import { PRODUCT_LIMIT } from "@/const"
import { listProducts } from "@/lib/data/products"
import { sortProducts } from "@/lib/helpers/sort-products"
import {
  getProductSellerIdentifiers,
  isSuspended,
  productMatchesPriceRange,
} from "@/lib/listing/policy"

type SortBy = "created_at" | "price_asc" | "price_desc"

type ListingSource = "search-index" | "store-api"

export type UnifiedProductListInput = {
  locale: string
  page?: number
  limit?: number
  query?: string
  sellerId?: string
  sellerHandle?: string
  categoryId?: string
  collectionId?: string
  minPrice?: number
  maxPrice?: number
  categories?: string[]
  productTypes?: string[]
  salesChannels?: string[]
  vendorTypes?: string[]
  sizes?: string[]
  colors?: string[]
  conditions?: string[]
  sortBy?: SortBy
}

export type UnifiedProductListResult = {
  products: HttpTypes.StoreProduct[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  source: ListingSource
  diagnostics: {
    droppedByHydration: number
    droppedByCurrencyFilter: number
    droppedByPolicy: number
  }
}

const DEFAULT_DIAGNOSTICS = {
  droppedByHydration: 0,
  droppedByCurrencyFilter: 0,
  droppedByPolicy: 0,
}

const applyPolicyFilters = (
  products: HttpTypes.StoreProduct[],
  input: UnifiedProductListInput
) => {
  const diagnostics = { ...DEFAULT_DIAGNOSTICS }

  const filtered = products.filter((product) => {
    if (isSuspended(product)) {
      diagnostics.droppedByPolicy += 1
      return false
    }

    if (input.sellerId) {
      const sellerId = getProductSellerIdentifiers(product).id
      if (sellerId !== input.sellerId) {
        diagnostics.droppedByPolicy += 1
        return false
      }
    }

    if (input.sellerHandle) {
      const sellerHandle = getProductSellerIdentifiers(product).handle
      if (sellerHandle !== input.sellerHandle) {
        diagnostics.droppedByPolicy += 1
        return false
      }
    }

    return true
  })

  return { products: filtered, diagnostics }
}

const normalize = (value?: string | null) => (value || "").trim().toLowerCase()

const includesAny = (values: string[], selected: string[]) => {
  if (!selected.length) return true
  const normalizedValues = values.map(normalize).filter(Boolean)
  return selected.some((value) => normalizedValues.includes(normalize(value)))
}

// Marketplace facet fields read off products/variants that aren't on the
// Medusa SDK types (or are typed more strictly there).
type FacetVariant = {
  metadata?: Record<string, unknown> | null
  size?: string
  color?: string
  condition?: string
}

type FacetProduct = Omit<
  HttpTypes.StoreProduct,
  "categories" | "type" | "sales_channels" | "variants"
> & {
  categories?: { name?: string }[] | null
  type?: { value?: string } | null
  sales_channels?: { name?: string }[] | null
  seller?: { vendor_type?: string } | null
  variants?: FacetVariant[] | null
}

const getVariantMetadataValue = (variant: FacetVariant, key: string) => {
  const metadata = variant?.metadata
  if (!metadata || typeof metadata !== "object") {
    return ""
  }
  return String(metadata[key] || "")
}

const applyFacetFilters = (
  products: HttpTypes.StoreProduct[],
  input: UnifiedProductListInput
) => {
  const selectedCategories = input.categories ?? []
  const selectedTypes = input.productTypes ?? []
  const selectedSalesChannels = input.salesChannels ?? []
  const selectedVendorTypes = input.vendorTypes ?? []
  const selectedSizes = input.sizes ?? []
  const selectedColors = input.colors ?? []
  const selectedConditions = input.conditions ?? []

  const hasFacetFilters =
    selectedCategories.length > 0 ||
    selectedTypes.length > 0 ||
    selectedSalesChannels.length > 0 ||
    selectedVendorTypes.length > 0 ||
    selectedSizes.length > 0 ||
    selectedColors.length > 0 ||
    selectedConditions.length > 0 ||
    typeof input.minPrice === "number" ||
    typeof input.maxPrice === "number"

  if (!hasFacetFilters) {
    return products
  }

  return products.filter((product) => {
    const p = product as FacetProduct

    const categoryNames = (p.categories || []).map((category) =>
      String(category?.name || "")
    )
    if (!includesAny(categoryNames, selectedCategories)) {
      return false
    }

    const productType = String(p.type?.value || "")
    if (!includesAny(productType ? [productType] : [], selectedTypes)) {
      return false
    }

    const salesChannelNames = (p.sales_channels || []).map((channel) =>
      String(channel?.name || "")
    )
    if (!includesAny(salesChannelNames, selectedSalesChannels)) {
      return false
    }

    const vendorType = String(p.seller?.vendor_type || "")
    if (!includesAny(vendorType ? [vendorType] : [], selectedVendorTypes)) {
      return false
    }

    const variants = p.variants || []
    const variantSizes = variants.map((variant) =>
      String(getVariantMetadataValue(variant, "size") || variant?.size || "")
    )
    if (!includesAny(variantSizes, selectedSizes)) {
      return false
    }

    const variantColors = variants.map((variant) =>
      String(getVariantMetadataValue(variant, "color") || variant?.color || "")
    )
    if (!includesAny(variantColors, selectedColors)) {
      return false
    }

    const variantConditions = variants.map((variant) =>
      String(getVariantMetadataValue(variant, "condition") || variant?.condition || "")
    )
    if (!includesAny(variantConditions, selectedConditions)) {
      return false
    }

    if (
      (typeof input.minPrice === "number" || typeof input.maxPrice === "number") &&
      !productMatchesPriceRange(product, {
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
      })
    ) {
      return false
    }

    return true
  })
}

const getFromStoreApi = async (
  input: UnifiedProductListInput
): Promise<UnifiedProductListResult> => {
  const page = Math.max(1, input.page ?? 1)
  const limit = input.limit ?? PRODUCT_LIMIT
  const sortBy = input.sortBy ?? "created_at"

  const { response } = await listProducts({
    pageParam: page,
    countryCode: input.locale,
    category_id: input.categoryId,
    collection_id: input.collectionId,
    queryParams: {
      limit,
      q: input.query,
    } as HttpTypes.FindParams & HttpTypes.StoreProductParams,
  })

  const { products, diagnostics } = applyPolicyFilters(response.products, input)
  const facetFilteredProducts = applyFacetFilters(products, input)

  const sortedProducts =
    sortBy === "created_at" ? facetFilteredProducts : sortProducts(facetFilteredProducts, sortBy)

  const total =
    input.sellerId || input.sellerHandle || sortedProducts.length !== response.products.length
      ? sortedProducts.length
      : response.count
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return {
    products: sortedProducts,
    total,
    page,
    pageSize: limit,
    totalPages,
    source: "store-api",
    diagnostics,
  }
}

const getFromSearchIndex = async (
  _input: UnifiedProductListInput
): Promise<UnifiedProductListResult | null> => {
  // Search-index adapter placeholder:
  // keep deterministic fallback path while unifying route consumption.
  return null
}

export const listUnifiedProducts = async (
  input: UnifiedProductListInput
): Promise<UnifiedProductListResult> => {
  const primary =
    (process.env.NEXT_PUBLIC_STOREFRONT_LISTING_PRIMARY_SOURCE as ListingSource | undefined) ??
    "store-api"

  if (primary === "search-index") {
    const indexed = await getFromSearchIndex(input)
    if (indexed) {
      return indexed
    }
  }

  return getFromStoreApi(input)
}
