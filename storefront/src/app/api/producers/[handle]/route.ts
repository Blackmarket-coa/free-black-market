import { logger } from "@/lib/logger"
import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params

    const response = await fetch(`${BACKEND_URL}/store/producers/${handle}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      return NextResponse.json(
        { producer: null, message: "Producer not found" },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error("Error fetching producer:", error)
    return NextResponse.json(
      { producer: null, message: "Internal error" },
      { status: 500 }
    )
  }
}
