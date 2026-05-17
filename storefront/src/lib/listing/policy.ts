import { HttpTypes } from "@medusajs/types"

export const SUSPENDED_STATUS = "SUSPENDED"

export const SUSPENDED_SELLER_ALGOLIA_CLAUSE = `NOT seller.store_status:${SUSPENDED_STATUS}`

export const isSuspended = (product: HttpTypes.StoreProduct): boolean =>
  ((product as any)?.seller?.store_status as string | undefined) === SUSPENDED_STATUS

export const getProductSellerIdentifiers = (product: HttpTypes.StoreProduct) => {
  const productAny = product as any

  return {
    id:
      (productAny?.seller?.id as string | undefined) ??
      (productAny?.seller?.seller_id as string | undefined) ??
      (productAny?.seller_id as string | undefined) ??
      (productAny?.metadata?.seller_id as string | undefined) ??
      "",
    handle:
      (productAny?.seller?.handle as string | undefined) ??
      (productAny?.metadata?.seller_handle as string | undefined) ??
      "",
  }
}

export type PriceRangeOptions = {
  currencyCode?: string
  minPrice?: number
  maxPrice?: number
}

const getVariantAmount = (variant: any): number | undefined => {
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

  const variants = ((product as any)?.variants || []) as any[]
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
