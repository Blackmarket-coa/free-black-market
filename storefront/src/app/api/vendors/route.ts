import { logger } from "@/lib/logger"
import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

/**
 * GET /api/vendors
 *
 * Proxy route to the backend /store/vendors unified vendor listing.
 * Forwards all query parameters for filtering and distance search.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const params = new URLSearchParams()

    // Forward all supported query params
    const forwardParams = [
      "vendor_type",
      "search",
      "featured",
      "lat",
      "lng",
      "zip",
      "radius_miles",
      "has_photo",
      "sort",
      "limit",
      "offset",
    ]

    for (const param of forwardParams) {
      if (searchParams.has(param)) {
        params.set(param, searchParams.get(param)!)
      }
    }

    const response = await fetch(`${BACKEND_URL}/store/vendors?${params}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      const requestId =
        response.headers.get("x-request-id") ||
        response.headers.get("x-correlation-id") ||
        null

      logger.error("[storefront/api/vendors] Backend request failed", {
        status: response.status,
        statusText: response.statusText,
        requestId,
        backendUrl: `${BACKEND_URL}/store/vendors?${params}`,
        query: Object.fromEntries(searchParams.entries()),
        errorText: errorText || null,
      })

      return NextResponse.json(
        {
          vendors: [],
          count: 0,
          message: "Could not fetch vendors",
          request_id: requestId,
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error("[storefront/api/vendors] Unhandled error", {
      backendUrl: `${BACKEND_URL}/store/vendors`,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { vendors: [], count: 0, message: "Internal error" },
      { status: 500 }
    )
  }
}
