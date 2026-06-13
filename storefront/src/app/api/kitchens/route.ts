import { logger } from "@/lib/logger"
import { NextResponse } from "next/server"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

/**
 * GET /api/kitchens
 *
 * Proxy route to the backend /store/kitchens endpoint.
 */
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/store/kitchens`, {
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      return NextResponse.json({ kitchens: [] })
    }

    const data = await response.json()
    return NextResponse.json({ kitchens: data.kitchens || [] })
  } catch (error) {
    logger.error("Failed to fetch kitchens:", error)
    return NextResponse.json({ kitchens: [] })
  }
}
