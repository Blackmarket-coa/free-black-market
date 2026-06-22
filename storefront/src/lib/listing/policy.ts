import { HttpTypes } from "@medusajs/types"

export const SUSPENDED_STATUS = "SUSPENDED"

export const SUSPENDED_SELLER_ALGOLIA_CLAUSE = `NOT seller.store_status:${SUSPENDED_STATUS}`

// Storefront products carry marketplace seller fields that are not on the
// Medusa SDK `StoreProduct` type; model just the fields these helpers read.
type ProductWithSellerFields = HttpTypes.StoreProduct & {
  seller?: {
    id?: string
    seller_id?: string
    handle?: string
    store_status?: string
  } | null
  seller_id?: string
  metadata?: { seller_id?: string; seller_handle?: string } | null
}

// A variant whose price we read either from the calculated price or the raw
// prices array (the latter is a marketplace extension, hence optional).
type PricedVariant = {
  calculated_price?: {
    calculated_amount?: number | null
    original_amount?: number | null
    currency_code?: string | null
  } | null
  prices?: { amount?: number | null }[] | null
}

export const isSuspended = (product: HttpTypes.StoreProduct): boolean =>
  (product as ProductWithSellerFields).seller?.store_status === SUSPENDED_STATUS

export const getProductSellerIdentifiers = (product: HttpTypes.StoreProduct) => {
  const p = product as ProductWithSellerFields

  return {
    id:
      p.seller?.id ??
      p.seller?.seller_id ??
      p.seller_id ??
      p.metadata?.seller_id ??
      "",
    handle: p.seller?.handle ?? p.metadata?.seller_handle ?? "",
  }
}

export type PriceRangeOptions = {
  currencyCode?: string
  minPrice?: number
  maxPrice?: number
}

const getVariantAmount = (variant: PricedVariant): number | undefined => {
  const amount =
    variant?.calculated_price?.calculated_amount ??
    variant?.calculated_price?.original_amount ??
    variant?.prices?.[0]?.amount
  return typeof amount === "number" ? amount : undefined
}

export const productMatchesPriceRange = (
  product: HttpTypes.StoreProduct,
  options: PriceRangeOptions
): boolean => {
  const { currencyCode, minPrice, maxPrice } = options
  const hasMin = typeof minPrice === "number"
  const hasMax = typeof maxPrice === "number"

  if (!currencyCode && !hasMin && !hasMax) {
    return true
  }

  const variants = product.variants ?? []
  const eligible = currencyCode
    ? variants.filter((v) => v?.calculated_price?.currency_code === currencyCode)
    : variants

  if (currencyCode && eligible.length === 0) {
    return false
  }

  if (!hasMin && !hasMax) {
    return true
  }

  return eligible.some((variant) => {
    const amount = getVariantAmount(variant)
    if (amount === undefined) return false
    if (hasMin && amount < (minPrice as number)) return false
    if (hasMax && amount > (maxPrice as number)) return false
    return true
  })
}
