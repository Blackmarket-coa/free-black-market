import { logger } from "@/lib/logger"
import { NextResponse } from "next/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/store/gardens`, {
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    })

    if (!response.ok) {
      // Return empty array if garden endpoint doesn't exist yet
      return NextResponse.json({ gardens: [] })
    }

    const data = await response.json()
    return NextResponse.json({ gardens: data.gardens || [] })
  } catch (error) {
    logger.error("Failed to fetch gardens:", error)
    // Return empty array on error
    return NextResponse.json({ gardens: [] })
  }
}
