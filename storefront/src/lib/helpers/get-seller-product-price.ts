import { convertToLocale } from "./money"

type VariantPrice = {
  amount?: number | null
  currency_code?: string
}

type SellerVariant = {
  id?: string
  sku?: string | null
  prices?: VariantPrice[] | null
}

type SellerProduct = {
  id?: string
  variants?: SellerVariant[] | null
}

export const getPricesForVariant = (
  variant: SellerVariant | null | undefined
) => {
  const price = variant?.prices?.[0]
  if (!price?.amount) {
    return null
  }

  const amount = price.amount
  const currency_code = price.currency_code ?? ""

  return {
    calculated_price_number: amount,
    calculated_price: convertToLocale({ amount, currency_code }),
    original_price_number: amount,
    original_price: convertToLocale({ amount, currency_code }),
  }
}

export function getSellerProductPrice({
  product,
  variantId,
}: {
  product: SellerProduct
  variantId?: string
}) {
  if (!product || !product.id) {
    throw new Error("No product provided")
  }

  const variants = product.variants ?? []

  const cheapestPrice = () => {
    if (!variants.length) {
      return null
    }

    const cheapestVariant = variants
      .filter((v) => !!v.prices?.[0])
      .sort((a, b) => (a.prices?.[0]?.amount ?? 0) - (b.prices?.[0]?.amount ?? 0))[0]

    return getPricesForVariant(cheapestVariant)
  }

  const variantPrice = () => {
    if (!variantId) {
      return null
    }

    const variant = variants.find(
      (v) => v.id === variantId || v.sku === variantId
    )

    if (!variant) {
      return null
    }

    return getPricesForVariant(variant)
  }

  return {
    product,
    cheapestPrice: cheapestPrice(),
    variantPrice: variantPrice(),
  }
}
