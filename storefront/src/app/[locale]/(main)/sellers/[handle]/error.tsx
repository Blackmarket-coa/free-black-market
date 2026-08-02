"use client"

import Link from "next/link"
import { useEffect } from "react"
import { logger } from "@/lib/logger"

/**
 * Scoped error boundary for public seller pages. Vendors send shoppers
 * straight to these URLs, so give them a recovery path back into the
 * directory instead of the generic route-group error page.
 */
export default function SellerPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error("[storefront] seller page error", {
      message: error?.message,
      digest: error?.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <h2 className="text-2xl font-semibold">
        We couldn&apos;t load this seller&apos;s page.
      </h2>
      <p className="max-w-md text-gray-600">
        The seller is still on the market — this is a temporary glitch on our
        side. Try again in a moment, or browse other producers while we sort
        it out.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-green-700 px-4 py-2 text-white hover:bg-green-800"
        >
          Try again
        </button>
        <Link
          href="/vendors"
          className="rounded-lg border px-4 py-2 hover:bg-gray-50"
        >
          Browse vendors
        </Link>
      </div>
    </div>
  )
}
