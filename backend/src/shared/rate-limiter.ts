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

/**
 * Derive the client IP for rate-limit keying.
 *
 * Uses Express's `req.ip`, which is only derived from `X-Forwarded-For` when the
 * app's `trust proxy` setting says so (configured from TRUST_PROXY — see
 * trustProxyMiddleware). We deliberately never read the raw `X-Forwarded-For`
 * header here: untrusted, it is attacker-controlled and lets a client mint an
 * unbounded number of buckets to defeat the per-IP cap.
 */
export function clientIp(req: MedusaRequest): string {
  return (
    req.ip ||
    (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ||
    "unknown"
  )
}

let trustProxyApplied = false

/**
 * Configure Express `trust proxy` from the TRUST_PROXY env var so `req.ip`
 * reflects the real client when the app sits behind a known proxy/load balancer.
 * TRUST_PROXY may be a hop count (e.g. "1") or a boolean-ish string. When unset,
 * `trust proxy` stays disabled and `req.ip` is the direct socket address — which
 * is exactly what we want, since an unproxied deployment must not trust
 * `X-Forwarded-For`. Idempotent; safe to register on any matcher.
 */
export function trustProxyMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (!trustProxyApplied) {
    trustProxyApplied = true
    const raw = process.env.TRUST_PROXY
    if (raw && raw !== "false" && raw !== "0") {
      const numeric = Number(raw)
      const value: number | boolean = Number.isFinite(numeric) ? numeric : true
      try {
        ;(req as any).app?.set?.("trust proxy", value)
      } catch {
        // best-effort; keying still falls back to the socket address
      }
    }
  }
  next()
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
    const ip = keyGenerator ? keyGenerator(req) : clientIp(req)

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

/**
 * Public catalog rate limiter: 120 requests per minute per IP.
 *
 * Protects the open, unauthenticated FBM Store API (`/store/vendors`,
 * `/store/vendors/:handle`) — the contract every Connect embed reads. Because
 * the SDK runs in each visitor's browser, the key is the visitor's IP, so a
 * generous ceiling avoids throttling legitimate multi-widget pages / SPA
 * navigation while still capping a single scraper. Aggregate load is absorbed
 * by the response's Cache-Control (CDN/browser caching), not by this limiter.
 */
export const publicCatalogRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyPrefix: "public-catalog",
})

/**
 * Embed key rate limiter: 100 requests per minute per publishable key.
 *
 * Applied to key-authenticated embed endpoints (`/store/embed/*` and the
 * optional keyed path of `/store/vendors/:handle`). Keyed by the resolved
 * embed key id (set on the request by the embed-key middleware) so a single
 * misbehaving site is throttled independently of others, falling back to IP
 * when no key id is present.
 */
export const embedKeyRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 100,
  keyPrefix: "embed-key",
  keyGenerator: (req) => {
    const keyId = (req as any).embed_key_id
    if (keyId) return `key:${keyId}`
    return clientIp(req)
  },
})

/**
 * Embed per-IP rate limiter: 40 requests per minute per client IP.
 *
 * Defense-in-depth for the `/store/embed/*` write/runtime endpoints on TOP of
 * the per-key limiter. The publishable key is public (embedded in each vendor
 * site's HTML) and the Origin header is spoofable by a non-browser client, so
 * `connect_domains` is an advisory filter, not authentication. This caps abuse
 * from a single source regardless of which (public) key it presents.
 */
export const embedIpRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 40,
  keyPrefix: "embed-ip",
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
    return clientIp(req)
  },
})
