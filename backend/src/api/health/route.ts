/**
 * Health Check Endpoint - Liveness Probe
 *
 * Used by Railway, Kubernetes, and load balancers to check if the service is alive.
 * This endpoint should return 200 if the process is running.
 *
 * Optimized for Railway:
 * - Fast response (<10ms) for quick health checks
 * - Includes memory stats for monitoring
 * - No database calls to ensure reliability
 *
 * Usage:
 * - Railway: Set healthcheckPath to "/health"
 * - Kubernetes: Use for livenessProbe
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getRuntimeModuleGateSnapshot } from "../../shared/runtime-module-gates"

// Track startup time
const _startTime = Date.now()

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const memUsage = process.memoryUsage()

  res.status(200).json({
    status: "ok",
    service: "freeblackmarket-backend",
    version: process.env.npm_package_version || "unknown",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    memory: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
    },
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
    runtime_module_gates: getRuntimeModuleGateSnapshot(),
  })
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)

  return parts.join(" ")
}
