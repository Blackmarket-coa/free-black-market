"use client"

import Link from "next/link"
import { useEffect } from "react"
import { logger } from "@/lib/logger"

/**
 * Route-segment error boundary for the main storefront group.
 *
 * Guarantees that an unexpected server/render error (e.g. a transient backend
 * failure during SSR) degrades to a friendly, recoverable page instead of a
 * blank HTTP 500. Pairs with the fail-soft data helpers so the storefront
 * stays usable even when an upstream call hiccups.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error("[storefront] route error", {
      message: error?.message,
      digest: error?.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <h2 className="text-2xl font-semibold">Something went wrong loading this page.</h2>
      <p className="max-w-md text-gray-600">
        We&apos;re on it. Try again in a moment, or head back to the homepage.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-green-700 px-4 py-2 text-white hover:bg-green-800"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border px-4 py-2 hover:bg-gray-50"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
