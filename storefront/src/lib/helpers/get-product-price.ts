import { HttpTypes } from "@medusajs/types"
import { getPercentageDiff } from "./get-precentage-diff"
import { convertToLocale } from "./money"
import { BaseHit, Hit } from "instantsearch.js"

/**
 * Minimal shape of the price data this module reads off a variant. The
 * storefront extends Medusa's `StoreCalculatedPrice` with tax-inclusive/
 * exclusive amounts that are not on the SDK type, so we model the fields we
 * actually touch here rather than fighting the upstream types.
 */
type CalculatedPrice = {
  calculated_amount?: number | null
  calculated_amount_with_tax?: number | null
  calculated_amount_without_tax?: number | null
  original_amount?: number | null
  original_amount_with_tax?: number | null
  currency_code?: string
  calculated_price?: { price_list_type?: string | null } | null
}

type PricedVariant = {
  id?: string
  sku?: string | null
  options?: HttpTypes.StoreProductVariant["options"]
  calculated_price?: CalculatedPrice | null
}

export const getPricesForVariant = (
  variant: PricedVariant | null | undefined
) => {
  const cp = variant?.calculated_price
  if (!cp || (!cp.calculated_amount_with_tax && !cp.calculated_amount)) {
    return null
  }

  // Hoist into locals so narrowing survives the intervening convertToLocale
  // calls and the optional API fields resolve to concrete numbers.
  const currency_code = cp.currency_code ?? ""
  const priceType = cp.calculated_price?.price_list_type ?? null
  const withTax = cp.calculated_amount_with_tax
  const withoutTax = cp.calculated_amount_without_tax ?? 0
  const original = cp.original_amount ?? 0
  const originalWithTax = cp.original_amount_with_tax ?? 0
  const calculated = cp.calculated_amount ?? 0

  if (!withTax) {
    return {
      calculated_price_number: calculated,
      calculated_price: convertToLocale({ amount: calculated, currency_code }),
      calculated_price_without_tax: convertToLocale({
        amount: withoutTax,
        currency_code,
      }),
      calculated_price_without_tax_number: withoutTax,
      original_price_number: original,
      original_price: convertToLocale({ amount: original, currency_code }),
      currency_code,
      price_type: priceType,
      percentage_diff: getPercentageDiff(original, calculated),
    }
  }

  return {
    calculated_price_number: withTax,
    calculated_price: convertToLocale({ amount: withTax, currency_code }),
    calculated_price_without_tax: convertToLocale({
      amount: withoutTax,
      currency_code,
    }),
    calculated_price_without_tax_number: withoutTax,
    original_price_number: originalWithTax,
    original_price: convertToLocale({ amount: originalWithTax, currency_code }),
    currency_code,
    price_type: priceType,
    percentage_diff: getPercentageDiff(original, calculated),
  }
}

export function getProductPrice({
  product,
  variantId,
}: {
  product: Hit<HttpTypes.StoreProduct> | Partial<Hit<BaseHit>>
  variantId?: string
}) {
  if (!product || !product.id) {
    throw new Error("No product provided")
  }

  const variants = (product.variants ?? []) as PricedVariant[]

  const cheapestVariant = (): PricedVariant | null => {
    if (!variants.length) {
      return null
    }

    return variants
      .filter((v) => !!v.calculated_price)
      .sort((a, b) => {
        const aWithTax = a.calculated_price?.calculated_amount_with_tax
        const bWithTax = b.calculated_price?.calculated_amount_with_tax
        return aWithTax && bWithTax
          ? aWithTax - bWithTax
          : (a.calculated_price?.calculated_amount ?? 0) -
              (b.calculated_price?.calculated_amount ?? 0)
      })[0]
  }

  const cheapestPrice = () => {
    if (!variants.length) {
      return null
    }

    return getPricesForVariant(cheapestVariant())
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
    cheapestVariant: cheapestVariant(),
  }
}
