import { logger } from "@/lib/logger"
import { NextResponse } from "next/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params

  try {
    const response = await fetch(`${BACKEND_URL}/store/gardens/${handle}`, {
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: "Garden not found" },
        { status: 404 }
      )
    }

    const data = await response.json()
    return NextResponse.json({ garden: data.garden })
  } catch (error) {
    logger.error("Failed to fetch garden:", error)
    return NextResponse.json(
      { error: "Failed to fetch garden" },
      { status: 500 }
    )
  }
}
