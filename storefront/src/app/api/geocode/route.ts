import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/geocode?zip=12345
 *
 * Thin proxy to the backend's `GET /store/geocode` (W5). This route used to
 * carry its own ~180-entry ZIP3 prefix table — a divergent subset of the
 * backend's ~900-entry copy, so the producers page and checkout could fail
 * to geocode a ZIP the vendors page resolved fine. The backend now holds
 * the single ZIP3 source (lib/zip3.ts) and, when the Blackout spatial
 * consumer is enabled, upgrades answers to a real geocoder. Response shape
 * is unchanged: `{ zip, latitude, longitude, approximate }`.
 */

const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  ""

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip")

  if (!zip || zip.length < 3) {
    return NextResponse.json(
      { error: "Please provide a valid US zip code" },
      { status: 400 }
    )
  }

  if (!MEDUSA_BACKEND_URL) {
    return NextResponse.json(
      { error: "Geocoding is not configured" },
      { status: 503 }
    )
  }

  try {
    const upstream = await fetch(
      `${MEDUSA_BACKEND_URL}/store/geocode?postal_code=${encodeURIComponent(zip)}`,
      {
        headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(5000),
        // Centroids move rarely; let Next cache the successful lookups.
        next: { revalidate: 3600 },
      }
    )
    const body = await upstream.json()
    return NextResponse.json(body, { status: upstream.status })
  } catch {
    return NextResponse.json(
      { error: "Could not find coordinates for this zip code" },
      { status: 404 }
    )
  }
}
