import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { createClient, RedisClientType } from "redis"
import { createLogger } from "./logger"
import { getSellerPlanLimits } from "./seller-plan"

const logger = createLogger("RateLimiter")

/**
 * Embed ceiling applied when no vendor can be resolved for the request, or when
 * the plan lookup fails. Matches the free tier in
 * `modules/vendor-plan/limits.ts` — the most restrictive real plan, so an
 * unresolved request never buys a higher ceiling than a paying vendor's.
 */
const EMBED_FALLBACK_MAX = 60

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
    const sweep = setInterval(() => {
      const now = Date.now()
      for (const [key, record] of this.store.entries()) {
        if (now > record.resetAt) {
          this.store.delete(key)
        }
      }
    }, 5 * 60 * 1000)
    sweep.unref?.()
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
 * Uses atomic INCR operations for distributed rate limiting.
 *
 * SEC-5: a request must never wait on Redis, and a Redis problem must never
 * turn the limiter off. The previous version did both. `increment` returned
 * `{ count: 1 }` whenever Redis was unreachable or a command failed, so every
 * request was allowed (while the log said "using memory store"); and because
 * node-redis keeps reconnecting, `connect()` never settles while Redis is
 * down, so with REDIS_URL set and Redis unreachable at boot every rate-limited
 * request awaited it forever — and the default offline queue held commands the
 * same way during a later outage. Now the client connects in the background
 * with capped reconnect backoff, commands fail fast while it is not ready
 * (`disableOfflineQueue`), and whenever it is not ready or a command throws,
 * the count comes from a real in-memory store: still limiting, per process
 * rather than across instances, until Redis is back.
 */
class RedisStore implements RateLimitStore {
  private client: RedisClientType | null = null
  private prefix: string
  private fallback: MemoryStore | null = null
  private warnedFallback = false

  constructor(prefix = "rl:") {
    this.prefix = prefix
  }

  /** Start connecting once, without ever awaiting it on a request path. */
  private ready(): boolean {
    if (!this.client && process.env.REDIS_URL) {
      const client = createClient({
        url: process.env.REDIS_URL,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 3000,
          reconnectStrategy: (retries: number) => Math.min(500 * 2 ** retries, 30_000),
        },
      }) as RedisClientType
      client.on("error", () => {}) // connection errors surface as !isReady
      client.on("ready", () => {
        this.warnedFallback = false
        logger.info("Redis rate limiter connected")
      })
      client.connect().catch(() => {})
      this.client = client
    }
    return Boolean(this.client?.isReady)
  }

  private memory(): MemoryStore {
    if (!this.warnedFallback) {
      this.warnedFallback = true
      logger.warn(
        "Redis rate limiter unavailable; counting in memory until it reconnects " +
          "(limits apply per process, not across instances)"
      )
    }
    if (!this.fallback) this.fallback = new MemoryStore()
    return this.fallback
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    if (!this.ready()) return this.memory().get(key)

    try {
      const data = await this.client!.get(this.prefix + key)
      return data ? JSON.parse(data) : null
    } catch {
      return this.memory().get(key)
    }
  }

  async set(key: string, record: RateLimitRecord): Promise<void> {
    if (!this.ready()) return this.memory().set(key, record)

    try {
      const ttl = Math.ceil((record.resetAt - Date.now()) / 1000)
      if (ttl > 0) {
        await this.client!.setEx(this.prefix + key, ttl, JSON.stringify(record))
      }
    } catch {
      await this.memory().set(key, record)
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    if (!this.ready()) return this.memory().increment(key, windowMs)

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
      return this.memory().increment(key, windowMs)
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
 * Spend one unit of a named budget in the shared limiter store, outside any
 * route: Redis when REDIS_URL is set (so every process and restart counts
 * against one budget), else the same in-process store the middleware
 * limiters fall back to. Resolves false once `max` is spent in the window.
 *
 * For budgets that belong to an actor rather than to a request, such as the
 * wellness automation sends a seller can trigger from several routes, jobs
 * and subscribers. Like the middleware limiters, it fails open when Redis is
 * configured but unreachable.
 */
export async function consumeRateLimit(key: string, windowMs: number, max: number): Promise<boolean> {
  const record = await getStore().increment(key, windowMs)
  return record.count <= max
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

/**
 * Maximum requests per window.
 *
 * A function is resolved per request, which is what makes a limit a billable
 * meter rather than a module constant — see `embedKeyRateLimiter`. Resolvers
 * must not throw; one that does falls back to `fallbackMax` rather than
 * failing the request, because a rate limiter is the wrong place to turn a
 * lookup blip into a 500.
 */
export type RateLimitMax =
  | number
  | ((req: MedusaRequest) => number | Promise<number>)

export interface RateLimiterOptions {
  /** Time window in milliseconds */
  windowMs: number
  /** Maximum requests per window */
  max: RateLimitMax
  /**
   * Limit applied when a `max` resolver throws. Required when `max` is a
   * function; ignored otherwise.
   */
  fallbackMax?: number
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
  const fallbackMax =
    typeof max === "number" ? max : (options.fallbackMax ?? 60)
  const store = getStore()

  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    let effectiveMax = fallbackMax
    if (typeof max === "function") {
      try {
        const resolved = await max(req)
        if (Number.isFinite(resolved) && resolved > 0) {
          effectiveMax = resolved
        }
      } catch (error) {
        logger.warn(
          `Rate limit resolver for "${keyPrefix}" failed; applying fallback of ${fallbackMax}`,
          error as Error
        )
      }
    }

    const ip = keyGenerator ? keyGenerator(req) : clientIp(req)

    const key = `${keyPrefix}:${ip}`

    // Use atomic increment from store
    const record = await store.increment(key, windowMs)
    const now = Date.now()

    // Set rate limit headers
    res.set("X-RateLimit-Limit", String(effectiveMax))
    res.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, effectiveMax - record.count))
    )
    res.set("X-RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)))

    if (record.count > effectiveMax) {
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
 * Embed key rate limiter: per publishable key, **scaled by the vendor's plan**.
 *
 * Applied to key-authenticated embed endpoints (`/store/embed/*` and the
 * optional keyed path of `/store/vendors/:handle`). Keyed by the resolved
 * embed key id (set on the request by the embed-key middleware) so a single
 * misbehaving site is throttled independently of others, falling back to IP
 * when no key id is present.
 *
 * This is the one embed limiter that scales: it caps how much traffic a
 * vendor's own site may drive through FBM, which is exactly the thing a vendor
 * buys more of. `requireEmbedKey` runs before this middleware and sets
 * `embed_seller_id`, so the plan is resolvable from the request; when it is
 * absent (the keyless `/store/vendors/**` path) the free-tier ceiling applies.
 */
export const embedKeyRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: async (req) => {
    const sellerId = (req as { embed_seller_id?: string }).embed_seller_id
    if (!sellerId) return EMBED_FALLBACK_MAX
    const { limits } = await getSellerPlanLimits(req.scope, sellerId)
    return limits.embed_requests_per_minute
  },
  fallbackMax: EMBED_FALLBACK_MAX,
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
 *
 * Deliberately NOT plan-scaled, unlike `embedKeyRateLimiter`. This bounds one
 * client, not one vendor — a vendor's real visitors arrive from many IPs, so
 * raising it with the plan would only widen what a single abuser can do while
 * doing nothing for legitimate traffic.
 */
export const embedIpRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 40,
  keyPrefix: "embed-ip",
})

/**
 * Supplier status webhook (`POST /webhooks/suppliers/status`): 120 per minute
 * per client IP, in its own bucket.
 *
 * The route is public; authenticity is the per-supplier HMAC it checks before
 * reading anything (see `modules/supplier-forwarding/webhook-auth.ts`). This
 * caps how hard one source can hammer it, signed or not. Its own keyPrefix,
 * not `standardRateLimiter`'s shared "standard:<ip>" bucket, so a supplier
 * pushing a batch of status changes cannot spend another endpoint's budget or
 * be starved by one. 120 leaves room for a supplier reporting a few dozen
 * orders through several statuses at once from one address.
 */
export const supplierWebhookRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyPrefix: "supplier-webhook",
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

/**
 * Wholesale account applications: 5 per hour per client IP.
 *
 * `POST /store/wholesale-application` needs only the public publishable key,
 * stores an application row and emails `wholesale-application-received` to
 * whatever address the body names. Until the email templates existed that
 * send was dropped, so the route's only cost was a row; once it really sends,
 * an unthrottled route lets anyone mail any address from FBM's sending domain,
 * and a domain whose reputation drops takes the order confirmation down with
 * it. Its own prefix, so applications and vendor sign-ups cannot spend each
 * other's budget. The email itself carries no text from the request (see the
 * template), so what a caller can do inside this budget is confirm an
 * application, not write a message.
 */
export const wholesaleApplicationRateLimiter = createRateLimiter({
  windowMs: 3600_000,
  max: 5,
  keyPrefix: "wholesale-application",
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

/**
 * Seller and listing reports (anonymous): 10 per hour per client IP, one
 * budget shared by `POST /store/seller-reports` and `POST /store/product-reports`.
 *
 * Both take a report from anyone, with no session, and write a row into the
 * admin request queue; without a ceiling one client could bury the real
 * notices in it. IP-keyed is right here only because the storefront submits
 * both forms from the reporter's browser rather than from a server action, so
 * the address is the reporter's and not the storefront's (SD-58 is what an
 * IP-keyed limiter does to traffic that all arrives from the storefront). Its
 * own keyPrefix, so bug reports and reports do not share a budget.
 */
export const storeReportRateLimiter = createRateLimiter({
  windowMs: 3600_000,
  max: 10,
  keyPrefix: "store-report",
})

// ============================================================
// Hawala and wellness money-path limiters.
//
// These budgets were declared in nested `middlewares.ts` files under
// `api/{store,vendor}/hawala` and `api/vendor/wellness`, which Medusa never
// loaded (its MiddlewareFileLoader reads only `src/api/middlewares.ts`). They
// are carried over here as declared — same window, same max — and wired
// through `src/api/middlewares.ts` via each surface's `_middlewares.ts`.
//
// Two things changed from the dead originals, both deliberately:
//   - Each limiter has its OWN keyPrefix. `standardRateLimiter` keys every
//     route that uses it into one "standard:<ip>" bucket, so donation or
//     contribution traffic could otherwise throttle deposits and vice versa.
//   - The shared store (Redis when REDIS_URL is set) replaces an unbounded
//     per-file in-process Map.
// The key is the dead files' own: the authenticated actor (falling back to the
// client IP) plus the request path, so each endpoint keeps its own bucket. The
// path is canonicalised (`canonicalRequestPath`), so one endpoint spelled
// several ways is still one bucket. The
// framework's /store auth and Mercur's /vendor/* auth both run before any
// project middleware, so the actor is already resolved when these run.
// ============================================================

/** `actor:<id>` when a caller is authenticated, else `ip:<ip>`. */
function actorOrIp(req: MedusaRequest): string {
  const ctx = (req as { auth_context?: { actor_id?: unknown } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id.length > 0
    ? `actor:${ctx.actor_id}`
    : `ip:${clientIp(req)}`
}

/**
 * The request's path in one spelling per endpoint: the full path (mount
 * prefix included), each segment percent-decoded, lower-cased, with repeated
 * and trailing slashes removed.
 *
 * Express matches routes case-insensitively, ignores a trailing slash
 * (non-strict routing) and percent-decodes params, but `req.path` is the raw
 * path as sent. A limiter keyed on it gave `/STORE/hawala/deposit`,
 * `/store/hawala/deposit/` and `/vendor/hawala/pools/pool%5F1/withdraw` each a
 * fresh budget for the same handler and the same resource. Every spelling
 * the router sends to one handler with the same params now has one key:
 * lower-casing and decoding only merge spellings, never split one.
 *
 * Not `req.route.path`: under `app[method]` it is the matcher, so the
 * `/vendor/hawala/**` and `/vendor/wellness/**` read budgets would become one
 * bucket for every read under them, and under a method-less (`app.use`)
 * mount there is no `req.route` at all. `req.baseUrl` is that mount's prefix,
 * as the caller spelled it, and `req.path` is only the rest.
 */
export function canonicalRequestPath(req: MedusaRequest): string {
  const r = req as { baseUrl?: unknown; path?: unknown }
  const raw = `${typeof r.baseUrl === "string" ? r.baseUrl : ""}${typeof r.path === "string" ? r.path : ""}`
  const decoded = raw
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        // Malformed escapes: Express refuses such a param (400) before any
        // handler, so this spelling never shares a handler with another.
        return segment
      }
    })
    .join("/")
  return decoded.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/"
}

/**
 * `actor:<id>:<path>` when a caller is authenticated, else `ip:<ip>:<path>`.
 * The path keeps one endpoint's traffic from spending another's budget, as the
 * dead nested limiters did. It is `canonicalRequestPath`, not the raw
 * `req.path`, so re-casing the URL, adding a trailing slash or
 * percent-encoding an id does not buy a fresh budget.
 */
export function actorPathRateLimitKey(req: MedusaRequest): string {
  return `${actorOrIp(req)}:${canonicalRequestPath(req)}`
}

/**
 * A signed-in customer's own account under `/store/customers/me/**`: 120 per
 * minute per actor per endpoint.
 *
 * Issue #97. These reads used to sit under `authRateLimiter` (20 per minute,
 * keyed by IP) because its `/store/customers` entry had no method, and Medusa
 * registers a method-less middleware with `app.use`, which prefix-matches. The
 * storefront fetches the customer server-side, so every shopper arrives from
 * the storefront's own address and they all shared one 20-per-minute bucket:
 * a few people clicking through account tabs exhausted it, and the account
 * pages showed "We're refreshing your session" (a non-401 failure) for
 * everyone until the window reset. Keyed by actor here, so one customer's
 * navigation cannot spend another's budget. `router.js` runs the optional
 * /store customer authenticate before project middleware, so the actor is
 * resolved by the time this runs.
 */
export const storeCustomerAccountRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyPrefix: "store-customer-account",
  keyGenerator: actorPathRateLimitKey,
})

/**
 * The data-rights endpoints under `/store/customers/me`: 5 per 5 minutes per
 * actor per endpoint. `data-export` assembles every registered customer table
 * into one document and `deletion` anonymises the account and revokes its
 * login, so neither is something a person needs more than a handful of times.
 * Before #97 their only brake was the shared 20-per-minute IP bucket; moving
 * the account surface to the generous budget above must not loosen these.
 */
export const storeCustomerDataRightsRateLimiter = createRateLimiter({
  windowMs: 300_000,
  max: 5,
  keyPrefix: "store-customer-data-rights",
  keyGenerator: actorPathRateLimitKey,
})

/**
 * The delivery a proof-of-delivery request is about, keyed per actor:
 * `actor:<id>:delivery-proof:<delivery id>`. Both URLs that reach the proof
 * handler (`POST /store/food-deliveries/:id/proof`, and `POST
 * /store/food-deliveries/:id?x=/proof`, whose path has no `/proof`) share one
 * bucket, which `actorPathRateLimitKey` would split in two. Keyed per actor
 * so a stranger's refused requests cannot spend the courier's budget.
 *
 * The delivery is `req.params.id`, the decoded id the proof handler itself
 * looks up, lower-cased. It used to be cut from the raw `req.path` with a
 * case-sensitive pattern, but Express matches routes case-insensitively and
 * percent-decodes params: `/store/food-deliveries/%66d_1/proof`, `fd%5F1`
 * and `/STORE/food-deliveries/fd_1/proof` all reach the handler as `fd_1`,
 * and each was a fresh bucket, so the courier had unlimited PIN guesses.
 * Medusa registers method-scoped middleware with `app[method](matcher)`, so
 * `req.params` is populated here. Without an id (the limiter mounted on a
 * matcher with no `:id`) every request of that actor shares one bucket,
 * which is stricter, never looser.
 */
export function deliveryProofRateLimitKey(req: MedusaRequest): string {
  const id = (req as { params?: { id?: unknown } }).params?.id
  const delivery = typeof id === "string" && id.length > 0 ? id.toLowerCase() : "*"
  return `${actorOrIp(req)}:delivery-proof:${delivery}`
}

/**
 * Proof of delivery: 5 attempts per 15 minutes per actor per delivery.
 *
 * The assigned courier is exactly who a delivery PIN guards against, and
 * nothing limited guessing: a 4-digit PIN was 10,000 scripted requests. With
 * PINs of 4 to 10 digits (`DELIVERY_PIN_PATTERN`) this allows the courier 480
 * guesses a day per delivery, so half the 4-digit space takes over ten days
 * for a delivery that is closed within hours. That bound holds only because
 * the key is the decoded delivery id (`deliveryProofRateLimitKey`); keyed on
 * the raw path, every re-spelling of the URL was another 480. A courier who
 * mistypes five times waits 15 minutes. Without a shared store (`REDIS_URL`
 * unset or down, SD-62) the budget is per process, so N instances allow N
 * times this.
 */
export const storeDeliveryProofRateLimiter = createRateLimiter({
  windowMs: 900_000,
  max: 5,
  keyPrefix: "store-delivery-proof",
  keyGenerator: deliveryProofRateLimitKey,
})

/** Store wallet deposit and withdraw (ACH pull / push): 5 per minute. */
export const storeHawalaMoneyRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "hawala-store-money",
  keyGenerator: actorPathRateLimitKey,
})

/** Store pool investment: 10 per minute. */
export const storeHawalaInvestRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "hawala-store-invest",
  keyGenerator: actorPathRateLimitKey,
})

/** Store bank-account linking: 3 per hour. */
export const storeHawalaBankAccountRateLimiter = createRateLimiter({
  windowMs: 3_600_000,
  max: 3,
  keyPrefix: "hawala-store-bank-account",
  keyGenerator: actorPathRateLimitKey,
})

/** Store hawala reads: 30 per minute per endpoint. */
export const storeHawalaReadRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "hawala-store-read",
  keyGenerator: actorPathRateLimitKey,
})

/** Vendor payouts, advances, payments and pool withdrawals: 5 per minute. */
export const vendorHawalaMoneyRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "hawala-vendor-money",
  keyGenerator: actorPathRateLimitKey,
})

/** Vendor pool creation: 10 per hour. */
export const vendorHawalaPoolCreateRateLimiter = createRateLimiter({
  windowMs: 3_600_000,
  max: 10,
  keyPrefix: "hawala-vendor-pool-create",
  keyGenerator: actorPathRateLimitKey,
})

/** Vendor hawala reads: 30 per minute per endpoint. */
export const vendorHawalaReadRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "hawala-vendor-read",
  keyGenerator: actorPathRateLimitKey,
})

/** Wellness automation test sends (each one is a Blackout DM): 5 per minute. */
export const vendorWellnessTestSendRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "wellness-test-send",
  keyGenerator: actorPathRateLimitKey,
})

/** Vendor wellness reads: 60 per minute per endpoint. */
export const vendorWellnessReadRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: "wellness-read",
  keyGenerator: actorPathRateLimitKey,
})
