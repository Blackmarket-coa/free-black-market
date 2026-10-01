import { ApiLoader } from "@medusajs/framework/http"
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, parseCorsOrigins } from "@medusajs/framework/utils"
import { createLogger } from "../../shared/logger"
import { originAllowed, originHostname } from "../../shared/embed-auth"
import { resolveEmbedContext } from "./embed-key"

const log = createLogger("api/middlewares/connect-cors")

/**
 * connect.js cross-origin gate.
 *
 * The shipped SDK versions (storefront/public/v*\/connect.js, frozen) call the
 * routes below from a vendor's own site with `Authorization: PublishableKey
 * pk_live_…` (the vendor embed key) and no `x-publishable-api-key`. Two pieces
 * of Medusa run on every /store request BEFORE any middleware in
 * `src/api/middlewares.ts` (see ApiLoader.load() in
 * @medusajs/framework/dist/http/router.js — store CORS, then
 * ensurePublishableApiKeyMiddleware, then locale/auth, and only then the
 * project's route middlewares):
 *
 *   1. Store CORS (STORE_CORS) answers the preflight itself — 204 with no
 *      Access-Control-Allow-Origin for a vendor origin — so the browser never
 *      sends the real request.
 *   2. The publishable-key check rejects the real request with 400 because
 *      the SDK does not send `x-publishable-api-key`.
 *
 * The only extension point Medusa exposes ahead of both is the static
 * `ApiLoader.traceMiddleware` instrumentation hook, which every framework
 * middleware is passed through at registration time. We use it to wrap the
 * /store CORS middleware (and nothing else) with this gate. For the connect.js
 * routes only, and only for a cross-origin request from outside STORE_CORS:
 *
 *   - Preflight: answered here when the Origin is in SOME vendor's
 *     `connect_domains`. A preflight carries no Authorization header, so it
 *     cannot be tied to a specific key; the actual request is.
 *   - Actual request: the embed key is verified (unknown/revoked keys rejected)
 *     and the Origin must be in THAT key's vendor's `connect_domains`
 *     (resolveEmbedContext, shared with requireEmbedKey/optionalEmbedKey).
 *     Only then do we allow the origin and satisfy Medusa's publishable-key
 *     check by presenting the platform key (FBM_CONNECT_PUBLISHABLE_KEY) — the
 *     same key the FBM storefront uses. Medusa still validates that key itself.
 *
 * Everything else — any other /store route, keyless requests, invalid or
 * revoked keys, unregistered origins — falls through to Medusa's store CORS and
 * publishable-key check exactly as before. First-party (STORE_CORS) origins
 * keep Medusa's CORS answer; a verified key from one is only given the
 * platform key so the publishable-key check passes. The route-level
 * middlewares (optionalEmbedKey / requireEmbedKey, per-key and per-IP rate
 * limiters) still run after this for every request.
 */

/** The routes the shipped connect.js calls, by method. Paths are full (/store/…). */
const CONNECT_ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: RegExp }> = [
  { method: "GET", path: /^\/store\/vendors\/[^/]+\/?$/ },
  { method: "GET", path: /^\/store\/vendors\/[^/]+\/(?:reviews|availability)\/?$/ },
  { method: "GET", path: /^\/store\/collective\/demand-pools\/?$/ },
  {
    method: "POST",
    path: /^\/store\/embed\/(?:bookings|chat\/start|events|drives\/checkout)\/?$/,
  },
]

/** Headers connect.js sends (Accept is safelisted; listed for completeness). */
const CONNECT_ALLOWED_HEADERS = "Authorization, Content-Type, Accept"
const PREFLIGHT_MAX_AGE_SECONDS = 86400
const PUBLISHABLE_KEY_HEADER = "x-publishable-api-key"

export function isConnectRoute(method: string, path: string): boolean {
  const m = method.toUpperCase()
  return CONNECT_ROUTES.some((r) => r.method === m && r.path.test(path))
}

/** The platform publishable key presented to Medusa on a verified connect.js request. */
export function connectPlatformPublishableKey(): string | null {
  const value = process.env.FBM_CONNECT_PUBLISHABLE_KEY?.trim()
  return value ? value : null
}

// ---------------------------------------------------------------------------
// Registered-origin lookup for preflights (union of every vendor's list)
// ---------------------------------------------------------------------------

const REGISTERED_ORIGINS_TTL_MS = 60_000

let registeredOrigins: { domains: string[]; expires: number } | null = null
let registeredOriginsPending: Promise<string[]> | null = null

/** Test hook: drop the cached connect_domains union. */
export function resetConnectOriginCache(): void {
  registeredOrigins = null
  registeredOriginsPending = null
}

async function loadRegisteredDomains(req: MedusaRequest): Promise<string[]> {
  if (registeredOrigins && registeredOrigins.expires > Date.now()) {
    return registeredOrigins.domains
  }
  if (!registeredOriginsPending) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    registeredOriginsPending = query
      .graph({ entity: "seller_metadata", fields: ["connect_domains"] })
      .then(({ data }: { data: Array<{ connect_domains?: unknown }> }) => {
        const domains: string[] = []
        for (const row of data ?? []) {
          if (!Array.isArray(row?.connect_domains)) continue
          for (const d of row.connect_domains) {
            if (typeof d === "string") domains.push(d)
          }
        }
        registeredOrigins = {
          domains,
          expires: Date.now() + REGISTERED_ORIGINS_TTL_MS,
        }
        return domains
      })
      .finally(() => {
        registeredOriginsPending = null
      })
  }
  return registeredOriginsPending as Promise<string[]>
}

/** True when `origin` is in at least one vendor's `connect_domains`. */
export async function isRegisteredConnectOrigin(
  req: MedusaRequest,
  origin: string
): Promise<boolean> {
  if (!originHostname(origin)) return false
  return originAllowed(origin, await loadRegisteredDomains(req))
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** Mirrors the `cors` package's matching of STORE_CORS entries (string or RegExp). */
function isStoreCorsOrigin(req: MedusaRequest, origin: string): boolean {
  let storeCors: string | undefined
  try {
    const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
      projectConfig?: { http?: { storeCors?: string } }
    }
    storeCors = config?.projectConfig?.http?.storeCors
  } catch {
    return false
  }
  return parseCorsOrigins(storeCors ?? "").some((allowed) =>
    allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
  )
}

function appendVary(res: MedusaResponse, field: string): void {
  const current = res.getHeader("Vary")
  const value = Array.isArray(current) ? current.join(", ") : String(current ?? "")
  if (value === "*") return
  const fields = value.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean)
  if (fields.includes(field.toLowerCase())) return
  res.setHeader("Vary", value ? `${value}, ${field}` : field)
}

let warnedMissingPlatformKey = false

type Middleware = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => unknown

/**
 * Wrap Medusa's /store CORS middleware. `medusaStoreCors` is called for every
 * request this gate does not take over, so default behavior is unchanged.
 */
export function connectStoreCorsGate(medusaStoreCors: Middleware): Middleware {
  return async function connectAwareStoreCors(req, res, next) {
    const origin = req.headers.origin as string | undefined
    const requestMethod = req.headers["access-control-request-method"] as string | undefined
    const isPreflight = req.method === "OPTIONS" && !!requestMethod
    const method = isPreflight ? String(requestMethod).toUpperCase() : req.method
    const path = `${req.baseUrl ?? ""}${req.path ?? ""}`

    if (
      !origin ||
      !isConnectRoute(method, path) ||
      (req.method === "OPTIONS" && !isPreflight)
    ) {
      return medusaStoreCors(req, res, next)
    }

    let takeOver = false
    try {
      takeOver = isPreflight
        ? await shouldAnswerPreflight(req, origin)
        : await admitVerifiedRequest(req, origin)
    } catch (err) {
      log.warn("connect.js CORS gate failed; falling back to store CORS", err)
      takeOver = false
    }

    if (!takeOver) return medusaStoreCors(req, res, next)

    res.setHeader("Access-Control-Allow-Origin", origin)
    appendVary(res, "Origin")

    if (isPreflight) {
      res.setHeader("Access-Control-Allow-Methods", `${method}, OPTIONS`)
      res.setHeader("Access-Control-Allow-Headers", CONNECT_ALLOWED_HEADERS)
      res.setHeader("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE_SECONDS))
      res.statusCode = 204
      res.setHeader("Content-Length", "0")
      res.end()
      return
    }
    return next()
  }
}

/**
 * Preflight: a vendor origin registered by at least one vendor. First-party
 * (STORE_CORS) origins keep Medusa's answer (credentials etc.).
 */
async function shouldAnswerPreflight(
  req: MedusaRequest,
  origin: string
): Promise<boolean> {
  if (isStoreCorsOrigin(req, origin)) return false
  return isRegisteredConnectOrigin(req, origin)
}

/**
 * Actual request: only a verified, unrevoked embed key used from an origin in
 * that key's vendor's connect_domains is admitted. Keyless, invalid, revoked
 * and wrong-origin requests return false and fall through untouched (Medusa's
 * publishable-key check, then optionalEmbedKey/requireEmbedKey, reject them as
 * before). Returns false for first-party origins too, AFTER presenting the
 * platform key, so Medusa's store CORS still decorates those responses.
 */
async function admitVerifiedRequest(
  req: MedusaRequest,
  origin: string
): Promise<boolean> {
  const ctx = await resolveEmbedContext(req)
  if (ctx.ok !== true) return false

  if (!req.headers[PUBLISHABLE_KEY_HEADER]) {
    const platformKey = connectPlatformPublishableKey()
    if (platformKey) {
      req.headers[PUBLISHABLE_KEY_HEADER] = platformKey
    } else if (!warnedMissingPlatformKey) {
      warnedMissingPlatformKey = true
      log.warn(
        "FBM_CONNECT_PUBLISHABLE_KEY is not set; verified connect.js requests will still fail Medusa's publishable-key check"
      )
    }
  }

  return !isStoreCorsOrigin(req, origin)
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

const HOOK_MARKER = Symbol.for("fbm.connectStoreCorsHook")

type TraceMiddleware = NonNullable<typeof ApiLoader.traceMiddleware>

/** Medusa registers its /store CORS as a global middleware named `corsMiddleware`. */
export function isMedusaStoreCors(
  handler: unknown,
  route: { route: string; method?: string }
): boolean {
  return (
    typeof handler === "function" &&
    handler.name === "corsMiddleware" &&
    route?.route === "/store" &&
    !route.method
  )
}

/**
 * Install the gate via `ApiLoader.traceMiddleware`. Must run before
 * ApiLoader.load() registers the framework middlewares; importing
 * `src/api/middlewares.ts` satisfies that (load() imports middleware files
 * first). Chains any tracer already installed (OpenTelemetry via
 * instrumentation.ts) and is idempotent across HMR re-imports.
 */
export function installConnectStoreCorsHook(
  loader: { traceMiddleware?: TraceMiddleware } = ApiLoader
): void {
  const previous = loader.traceMiddleware as
    | (TraceMiddleware & { [HOOK_MARKER]?: true })
    | undefined
  if (previous?.[HOOK_MARKER]) return

  const hook = ((handler, route) => {
    const wrapped = isMedusaStoreCors(handler, route)
      ? (connectStoreCorsGate(handler as Middleware) as typeof handler)
      : handler
    return previous ? previous(wrapped, route) : wrapped
  }) as TraceMiddleware & { [HOOK_MARKER]?: true }
  hook[HOOK_MARKER] = true
  loader.traceMiddleware = hook
}
