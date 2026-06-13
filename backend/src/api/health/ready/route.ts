import { createLogger } from "../../../shared/logger"
const log = createLogger("api/health/ready")
/**
 * Readiness Check Endpoint
 *
 * Used by Railway, Kubernetes, and load balancers to check if the service
 * is ready to accept traffic. Checks database connectivity and optional Redis.
 *
 * Returns 200 if all critical services are available, 503 if degraded.
 *
 * Optimizations for Railway:
 * - Uses existing cache service instead of creating new Redis connections
 * - Caches database health check results briefly (5s) to reduce load
 * - Timeout-protected checks to prevent slow health check responses
 *
 * Usage:
 * - Kubernetes: Use for readinessProbe
 * - Load balancers: Use to determine if instance can receive traffic
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cache } from "../../../shared/cache"

interface HealthChecks {
  database: boolean
  redis: boolean | "not_configured"
}

// Cache the last database check result briefly to avoid hammering the DB
let lastDbCheck: { healthy: boolean; timestamp: number } | null = null
const DB_CHECK_CACHE_MS = 5000 // 5 seconds

// Timeout helper for health checks
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const checks: HealthChecks = {
    database: false,
    redis: "not_configured",
  }

  const startTime = Date.now()

  // Check database connectivity (with caching)
  const now = Date.now()
  if (lastDbCheck && now - lastDbCheck.timestamp < DB_CHECK_CACHE_MS) {
    checks.database = lastDbCheck.healthy
  } else {
    try {
      const query = req.scope.resolve("remoteQuery")
      // Simple query with timeout to verify database is reachable
      const dbCheckPromise = query({
        entryPoint: "region",
        fields: ["id"],
        variables: { take: 1 },
      })

      const result = await withTimeout(dbCheckPromise, 5000, null)
      checks.database = result !== null
      lastDbCheck = { healthy: checks.database, timestamp: now }
    } catch (error) {
      log.error("[Health] Database check failed:", error)
      checks.database = false
      lastDbCheck = { healthy: false, timestamp: now }
    }
  }

  // Check Redis using existing cache service (no new connections)
  if (process.env.REDIS_URL) {
    try {
      // Use the existing cache service's isAvailable method with timeout
      const redisCheckPromise = cache.isAvailable()
      checks.redis = await withTimeout(redisCheckPromise, 2000, false)
    } catch (error) {
      log.error("[Health] Redis check failed:", error)
      checks.redis = false
    }
  }

  const responseTime = Date.now() - startTime

  // Determine overall health status
  // Database is critical, Redis is optional (degrade gracefully)
  const databaseHealthy = checks.database
  // Only fail on Redis if it's configured AND unavailable
  // Redis being down should not make the service unhealthy, just degraded
  const status = databaseHealthy ? "ready" : "unhealthy"

  res.status(databaseHealthy ? 200 : 503).json({
    status,
    service: "freeblackmarket-backend",
    checks,
    degraded: checks.redis === false, // Indicate Redis degradation without failing
    responseTimeMs: responseTime,
    timestamp: new Date().toISOString(),
  })
}
