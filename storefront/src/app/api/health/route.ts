import { NextResponse } from "next/server"

const startTime = Date.now()

// Liveness/readiness probe for the Next.js storefront.
// Returns 200 once the route runtime is reachable.
// Distinct from /api/healthcheck (legacy) which is kept for backwards compatibility.
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "freeblackmarket-storefront",
      version: process.env.npm_package_version || "unknown",
      commit: process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - startTime,
      environment: process.env.NODE_ENV || "development",
    },
    { status: 200 }
  )
}
