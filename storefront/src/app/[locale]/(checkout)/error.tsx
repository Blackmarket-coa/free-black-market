"use client"

import Link from "next/link"
import { useEffect } from "react"
import { logger } from "@/lib/logger"

/**
 * Route-segment error boundary for the checkout group.
 *
 * Without this, a throw inside the checkout tree (e.g. StripeWrapper when the
 * publishable key / client_secret is missing) escaped to the app-level handler
 * and blanked the whole page mid-purchase. This keeps the failure inside
 * checkout with a recoverable "Try again", and a route back to the cart.
 */
export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error("[storefront] checkout error", {
      message: error?.message,
      digest: error?.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <h2 className="text-2xl font-semibold">
        We hit a problem starting checkout.
      </h2>
      <p className="max-w-md text-gray-600">
        No charge has been made. Try again in a moment, or head back to your
        cart to review your order.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-green-700 px-4 py-2 text-white hover:bg-green-800"
        >
          Try again
        </button>
        <Link
          href="/cart"
          className="rounded-lg border px-4 py-2 hover:bg-gray-50"
        >
          Back to cart
        </Link>
      </div>
    </div>
  )
}
