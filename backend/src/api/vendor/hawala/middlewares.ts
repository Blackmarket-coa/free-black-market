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
 * Simple in-memory rate limiter for vendor hawala routes
 * 
 * SECURITY: Prevents financial fraud via rapid automated requests
 * In production, use Redis-based rate limiting for distributed deployments
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
    
    // Set rate limit headers
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

// Strict rate limiter for high-value operations (5 per minute)
const strictRateLimiter = createRateLimiter({ windowMs: 60_000, max: 5 })

// Standard rate limiter (30 per minute)
const standardRateLimiter = createRateLimiter({ windowMs: 60_000, max: 30 })

/**
 * Vendor Hawala Routes Middleware
 * 
 * - Authentication: All routes require vendor authentication
 * - Rate Limiting: Financial operations are rate-limited
 */
export default defineMiddlewares({
  routes: [
    // All vendor hawala routes require authentication
    {
      matcher: "/vendor/hawala/**",
      middlewares: [authenticate("seller", ["bearer", "session"])],
    },
    
    // Rate limit payout requests (5 per minute)
    {
      matcher: "/vendor/hawala/payouts",
      method: "POST",
      middlewares: [strictRateLimiter as MiddlewareFunction],
    },
    
    // Rate limit advance requests (5 per minute)
    {
      matcher: "/vendor/hawala/advances",
      method: "POST",
      middlewares: [strictRateLimiter as MiddlewareFunction],
    },
    
    // Rate limit vendor payments (5 per minute)
    {
      matcher: "/vendor/hawala/payments",
      method: "POST",
      middlewares: [strictRateLimiter as MiddlewareFunction],
    },
    
    // Rate limit pool withdrawals (5 per minute)
    {
      matcher: "/vendor/hawala/pools/*/withdraw",
      method: "POST",
      middlewares: [strictRateLimiter as MiddlewareFunction],
    },
    
    // Rate limit pool creation (10 per hour)
    {
      matcher: "/vendor/hawala/pools",
      method: "POST",
      middlewares: [createRateLimiter({ windowMs: 3600_000, max: 10 }) as MiddlewareFunction],
    },
    
    // Standard rate limit for reads
    {
      matcher: "/vendor/hawala/**",
      method: "GET",
      middlewares: [standardRateLimiter as MiddlewareFunction],
    },
  ],
})
