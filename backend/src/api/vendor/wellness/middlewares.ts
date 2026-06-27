import {
  authenticate,
  defineMiddlewares,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareFunction,
} from "@medusajs/framework/http"
import type { VendorRequest } from "../types"

/**
 * In-memory rate limiter for vendor wellness routes (mirrors the hawala one).
 * Replace with Redis in distributed deployments.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function createRateLimiter(options: { windowMs: number; max: number }) {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const vendorId = (req as VendorRequest).auth_context?.actor_id || req.ip
    const key = `${vendorId}-${req.path}`
    const now = Date.now()

    let record = rateLimitStore.get(key)
    if (!record || record.resetAt < now) {
      record = { count: 0, resetAt: now + options.windowMs }
      rateLimitStore.set(key, record)
    }
    record.count++

    res.set("X-RateLimit-Limit", String(options.max))
    res.set("X-RateLimit-Remaining", String(Math.max(0, options.max - record.count)))
    res.set("X-RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)))

    if (record.count > options.max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000)
      res.set("Retry-After", String(retryAfter))
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
        retry_after_seconds: retryAfter,
      })
    }
    next()
  }
}

// Sending Blackout DMs hits the homeserver — keep test sends strict.
const strictRateLimiter = createRateLimiter({ windowMs: 60_000, max: 5 })
const standardRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })

export default defineMiddlewares({
  routes: [
    {
      matcher: "/vendor/wellness/**",
      middlewares: [authenticate("seller", ["bearer", "session"])],
    },
    {
      matcher: "/vendor/wellness/automations/test",
      method: "POST",
      middlewares: [strictRateLimiter as MiddlewareFunction],
    },
    {
      matcher: "/vendor/wellness/**",
      method: "GET",
      middlewares: [standardRateLimiter as MiddlewareFunction],
    },
  ],
})
