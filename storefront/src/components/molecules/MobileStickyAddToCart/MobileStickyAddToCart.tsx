"use client"

import { Button } from "@/components/atoms"
import { HttpTypes } from "@medusajs/types"

interface MobileStickyAddToCartProps {
  product: HttpTypes.StoreProduct
  price: string | null
  variantStock: number
  variantHasPrice: boolean
  hasAnyPrice: boolean
  isAdding: boolean
  onAddToCart: () => void
}

/**
 * Mobile sticky add-to-cart bar
 * Shows at bottom of screen on mobile devices when scrolled past main add-to-cart button
 */
export const MobileStickyAddToCart = ({
  product,
  price,
  variantStock,
  variantHasPrice,
  hasAnyPrice,
  isAdding,
  onAddToCart,
}: MobileStickyAddToCartProps) => {
  const isDisabled = !variantStock || !variantHasPrice || !hasAnyPrice

  // Lifted clear of the cookie-consent banner while it is shown (see
  // ConsentBanner), so the banner never hides the Add to Cart button's focus.
  return (
    <div className="lg:hidden fixed bottom-[var(--fbm-consent-offset,0px)] left-0 right-0 bg-white border-t shadow-lg z-40 safe-area-inset-bottom">
      <div className="container flex items-center justify-between gap-4 py-3 px-4">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate text-sm">
            {product.title}
          </p>
          {hasAnyPrice && price ? (
            <p className="text-green-600 font-bold">{price}</p>
          ) : (
            <p className="text-gray-500 text-sm">Not available</p>
          )}
        </div>

        {/* Add to cart button */}
        <Button
          onClick={onAddToCart}
          disabled={isDisabled}
          loading={isAdding}
          className="shrink-0 px-6 py-2.5"
          size="large"
        >
          {!hasAnyPrice
            ? "Unavailable"
            : variantStock && variantHasPrice
            ? "Add to Cart"
            : "Out of Stock"}
        </Button>
      </div>
    </div>
  )
}
