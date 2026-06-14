import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { createClient, RedisClientType } from "redis"
import { createLogger } from "./logger"

const logger = createLogger("RateLimiter")

/**
 * Rate Limiter Store Interface
 */
interface RateLimitRecord {
  count: number
  resetAt: number
}

interface RateLimitStore {
  get(key: string): Promise<RateLimitRecord | null>
  set(key: string, record: RateLimitRecord): Promise<void>
  increment(key: string, windowMs: number): Promise<RateLimitRecord>
}

/**
 * In-memory rate limiting store (fallback)
 */
class MemoryStore implements RateLimitStore {
  private store = new Map<string, RateLimitRecord>()

  constructor() {
    // Clean up expired entries periodically (every 5 minutes)
    setInterval(() => {
      const now = Date.now()
      for (const [key, record] of this.store.entries()) {
        if (now > record.resetAt) {
          this.store.delete(key)
        }
      }
    }, 5 * 60 * 1000)
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    return this.store.get(key) || null
  }

  async set(key: string, record: RateLimitRecord): Promise<void> {
    this.store.set(key, record)
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const now = Date.now()
    let record = this.store.get(key)
    
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs }
    }
    
    record.count++
    this.store.set(key, record)
    return record
  }
}

/**
 * Redis rate limiting store (production)
 * Uses atomic INCR operations for distributed rate limiting
 */
class RedisStore implements RateLimitStore {
  private client: RedisClientType | null = null
  private connecting: Promise<void> | null = null
  private connected = false
  private prefix: string

  constructor(prefix = "rl:") {
    this.prefix = prefix
  }

  private async connect(): Promise<boolean> {
    if (this.connected && this.client) return true
    if (!process.env.REDIS_URL) return false

    if (this.connecting) {
      await this.connecting
      return this.connected
    }

    this.connecting = (async () => {
      try {
        this.client = createClient({
          url: process.env.REDIS_URL,
          socket: { connectTimeout: 3000 },
        })
        this.client.on("error", () => {}) // Suppress error logs
        await this.client.connect()
        this.connected = true
        logger.info("Redis rate limiter connected")
      } catch (_error) {
        logger.warn("Redis rate limiter unavailable, using memory store")
        this.connected = false
      }
    })()

    await this.connecting
    this.connecting = null
    return this.connected
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    if (!await this.connect()) return null

    try {
      const data = await this.client!.get(this.prefix + key)
      return data ? JSON.parse(data) : null
    } catch {
      return null
    }
  }

  async set(key: string, record: RateLimitRecord): Promise<void> {
    if (!await this.connect()) return

    try {
      const ttl = Math.ceil((record.resetAt - Date.now()) / 1000)
      if (ttl > 0) {
        await this.client!.setEx(this.prefix + key, ttl, JSON.stringify(record))
      }
    } catch {
      // Ignore errors
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    if (!await this.connect()) {
      // Fallback behavior - create new record
      return { count: 1, resetAt: Date.now() + windowMs }
    }

    const redisKey = this.prefix + key
    const now = Date.now()
    const resetAt = now + windowMs
    const ttlSeconds = Math.ceil(windowMs / 1000)

    try {
      // Use atomic increment with TTL
      const count = await this.client!.incr(redisKey)
      
      // Set expiry on first increment
      if (count === 1) {
        await this.client!.expire(redisKey, ttlSeconds)
      }

      // Get actual TTL to calculate resetAt
      const ttl = await this.client!.ttl(redisKey)
      const actualResetAt = ttl > 0 ? now + (ttl * 1000) : resetAt

      return { count, resetAt: actualResetAt }
    } catch {
      return { count: 1, resetAt }
    }
  }
}

// Initialize appropriate store based on environment
let rateLimitStore: RateLimitStore

function getStore(): RateLimitStore {
  if (!rateLimitStore) {
    // Use Redis if available (in any environment), otherwise fall back to memory
    if (process.env.REDIS_URL) {
      rateLimitStore = new RedisStore()
      logger.info("Rate limiter using Redis store")
    } else {
      rateLimitStore = new MemoryStore()
      if (process.env.NODE_ENV === "production") {
        logger.warn("Using in-memory rate limiter - set REDIS_URL for distributed rate limiting")
      } else {
        logger.debug("Rate limiter using in-memory store (development mode)")
      }
    }
  }
  return rateLimitStore
}

export interface RateLimiterOptions {
  /** Time window in milliseconds */
  windowMs: number
  /** Maximum requests per window */
  max: number
  /** Key prefix for namespacing different rate limiters */
  keyPrefix?: string
  /** Custom key generator function */
  keyGenerator?: (req: MedusaRequest) => string
}

/**
 * Create a rate limiter middleware
 * 
 * @example
 * ```typescript
 * // 10 requests per minute
 * const authRateLimiter = createRateLimiter({ 
 *   windowMs: 60_000, 
 *   max: 10, 
 *   keyPrefix: "auth" 
 * })
 * ```
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, keyPrefix = "default", keyGenerator } = options
  const store = getStore()

  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const ip = keyGenerator 
      ? keyGenerator(req)
      : req.ip || (req.headers["x-forwarded-for"] as string) || "unknown"
    
    const key = `${keyPrefix}:${ip}`

    // Use atomic increment from store
    const record = await store.increment(key, windowMs)
    const now = Date.now()

    // Set rate limit headers
    res.set("X-RateLimit-Limit", String(max))
    res.set("X-RateLimit-Remaining", String(Math.max(0, max - record.count)))
    res.set("X-RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)))

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000)
      res.set("Retry-After", String(retryAfter))
      
      return res.status(429).json({
        message: "Too many requests, please try again later",
        type: "rate_limit_exceeded",
        retry_after: retryAfter,
      })
    }

    next()
  }
}

// Pre-configured rate limiters for common use cases

/** Standard rate limiter: 30 requests per minute */
export const standardRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "standard",
})

/** Auth rate limiter: 20 attempts per minute (login, register, etc.) */
export const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  keyPrefix: "auth",
})

/** Auth session rate limiter: 60 reads per minute (session checks, status reads) */
export const authSessionRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: "auth-session",
})

/** Strict auth rate limiter: 5 attempts per 5 minutes (for password reset, etc.) */
export const strictAuthRateLimiter = createRateLimiter({
  windowMs: 300_000,
  max: 5,
  keyPrefix: "auth-strict",
})

/** Upload rate limiter: 10 uploads per hour */
export const uploadRateLimiter = createRateLimiter({
  windowMs: 3600_000,
  max: 10,
  keyPrefix: "upload",
})

/** Vendor registration rate limiter: 5 attempts per 15 minutes */
export const vendorRegistrationRateLimiter = createRateLimiter({
  windowMs: 900_000, // 15 minutes
  max: 5,
  keyPrefix: "vendor-reg",
})

/** Bug report (anonymous): 5 submissions per hour per IP */
export const bugReportAnonymousRateLimiter = createRateLimiter({
  windowMs: 3600_000,
  max: 5,
  keyPrefix: "bug-report-anon",
})

/**
 * Bug report (authenticated): 20 submissions per hour per actor.
 * Falls back to IP if actor_id is missing.
 */
export const bugReportAuthRateLimiter = createRateLimiter({
  windowMs: 3600_000,
  max: 20,
  keyPrefix: "bug-report-auth",
  keyGenerator: (req) => {
    const actorId = (req as any).auth_context?.actor_id
    if (actorId) return `actor:${actorId}`
    return req.ip || (req.headers["x-forwarded-for"] as string) || "unknown"
  },
})
