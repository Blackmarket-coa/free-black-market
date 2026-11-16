import fs from "fs"
import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Every route OUTSIDE /store, /admin, /vendor and /auth, by who can call it.
 *
 * Medusa applies a default only inside those trees: admin auth on /admin, the
 * publishable key and optional customer auth on /store (Mercur guards
 * /vendor; /auth is how a caller gets a token). A route file anywhere else
 * under `src/api` is served to anyone on the internet, with no token and no
 * publishable key, unless a matcher or the handler itself says otherwise.
 * `/restaurants` sat there unguarded for its whole life: anyone could create a
 * restaurant, add products, and delete any product in the catalogue by id
 * (SD-116). The sweep that followed found `/tickets/:id/verify` open the same
 * way.
 *
 * So this spec walks `src/api` and fails when:
 *
 *   1. a route (file and verb) outside the four trees is not in REVIEWED
 *      below, or REVIEWED names one that no longer exists. Adding a route out
 *      here means deciding who may call it and writing that down, in the
 *      style of `lib/customer-data-registry.ts` and its walk;
 *   2. a route REVIEWED says a middleware guards is reached with no
 *      credentials, with the wrong actor's token, or through a re-spelled URL
 *      (re-cased, trailing slash, percent-encoded id; SD-86 and SD-87 were
 *      both raw-path matching);
 *   3. a route REVIEWED says its handler guards itself no longer contains the
 *      call named as its guard, in THAT verb's handler (a file whose GET
 *      checks and whose POST does not is the failure this is for);
 *   4. a middleware matcher appears outside the four trees that is not in
 *      BARE_MATCHERS: a terminating middleware serves content exactly like a
 *      route (the `/.well-known` alias does);
 *   5. a route closed out here still has an open twin under /store
 *      (STORE_TWINS: `/store/tickets/:id/verify` ran the same workflow behind
 *      nothing but the publishable key).
 *
 * What is real, as in `actor-path-rate-limit-key.unit.spec.ts`: Medusa's
 * MiddlewareFileLoader scanning `src/api`, its RoutesSorter, and every loaded
 * middleware outside the four trees registered on express the way ApiLoader
 * does it (method-less with `app.use`, the rest per verb). Stand-ins: the
 * route handlers (sentinels, so "reached" means the real handler would have
 * run), and `req.session` for a signed-in admin's cookie.
 * `integration-tests/http/bare-prefix-authz.spec.ts` has the same doors on the
 * assembled app and a real database.
 */

// The limiter store is chosen when the first limiter is created. Pin the
// in-memory store before anything imports shared/rate-limiter.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL
const ORIGINAL_ADMIN_CORS = process.env.ADMIN_CORS

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => {
    scanDir(dir: string): Promise<void>
    getMiddlewares(): LoadedMiddleware[]
  }
}
const { RoutesSorter } = require(path.join(httpDir, "routes-sorter")) as {
  RoutesSorter: new (routes: SortableEntry[]) => { sort(): SortableEntry[] }
}
const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
  wrapHandler: (fn: Handler) => Handler
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type SentinelRoute = { isRoute: true; matcher: string; method: string; handler: Handler }
type SortableEntry = LoadedMiddleware | SentinelRoute

const API_DIR = path.resolve(__dirname, "..")
const GUARDED_TREES = ["store", "admin", "vendor", "auth"]
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
const JWT_SECRET = "bare-prefix-route-guards-spec-secret"
const ADMIN_ORIGIN = "https://admin.bare-prefix-spec.test"

// ---------------------------------------------------------------------------
// The reviewed list
// ---------------------------------------------------------------------------

type Actor = "admin" | "seller" | "restaurant" | "driver" | "restaurant-or-driver"
type Guard =
  /** A matcher in middlewares.ts (or a file it spreads) refuses everyone else before the handler. */
  | { by: "middleware"; actor: Actor }
  /** The handler refuses; `calls` is text its route file must contain. */
  | { by: "handler"; how: string; calls: string }
  /** Anyone may call it. `why` says why that is right and what it gives out. */
  | { by: "public"; why: string }

const mw = (actor: Actor): Guard => ({ by: "middleware", actor })
const handler = (how: string, calls: string): Guard => ({ by: "handler", how, calls })
const pub = (why: string): Guard => ({ by: "public", why })

const ADMIN = mw("admin")
const SELLER = mw("seller")
const ENTITLEMENTS = handler(
  "Blackout service token (ENTITLEMENTS_SERVICE_TOKEN or a client-credentials JWT); 503 while FBM_BLACKOUT_INTEGRATION is off",
  "requireEntitlementsAuth(req, res)"
)
const COMMERCE_KEY = handler(
  "Blackout commerce API key (FREEBLACKMARKET_API_KEY, constant-time); 503 while FBM_BLACKOUT_INTEGRATION is off",
  "requireCommerceApiKey(req, res)"
)

/**
 * `"VERB /path"` -> who can call it. The path is the route file's, with
 * `[id]` written `:id`. Keep an entry beside its neighbours; a new one needs
 * the same three answers the sweep gave for these: who can call it, what it
 * writes, what it returns.
 */
const REVIEWED: Record<string, Guard> = {
  // --- /restaurants: admin only (SD-116). Written for a "restaurant" actor
  // nobody can hold; who that is, and whether these stay, is the operator's.
  "GET /restaurants": ADMIN,
  "POST /restaurants": ADMIN,
  "GET /restaurants/:id": ADMIN,
  "POST /restaurants/:id/products": ADMIN,
  "DELETE /restaurants/:id/products": ADMIN,
  "DELETE /restaurants/:id/admins/:admin_id": ADMIN,

  // --- /tickets: admin only. Marks a ticket scanned; no client calls it and
  // nothing says who scans at the door, so it fails closed.
  "POST /tickets/:id/verify": ADMIN,

  // --- /deliveries: the restaurant-marketplace workflow (deliveries/[id]/_middlewares.ts).
  "POST /deliveries/:id/accept": mw("restaurant"),
  "POST /deliveries/:id/prepare": mw("restaurant"),
  "POST /deliveries/:id/ready": mw("restaurant"),
  "POST /deliveries/:id/claim": mw("driver"),
  "POST /deliveries/:id/pick-up": mw("driver"),
  "POST /deliveries/:id/complete": mw("driver"),
  "GET /deliveries/:id/subscribe": mw("restaurant-or-driver"),

  // --- /users: creates a restaurant admin or a driver for the caller's auth
  // identity. No matcher authenticates the path, so `auth_context` is never
  // set and every call is 401: dead, and closed. A matcher added here opens
  // it; that matcher is what needs the review.
  "POST /users": handler("requires an auth identity no middleware supplies: always 401", "req.auth_context?.auth_identity_id"),

  // --- public by intent
  "GET /health": pub("liveness probe: process uptime, memory, version and the module-gate snapshot; no database read, no row data"),
  "GET /health/ready": pub("readiness probe: database and Redis reachable, as booleans"),
  "GET /key-exchange": pub("hands the storefront its PUBLISHABLE key, which every page of the storefront already carries; a secret key's token is not stored, so one titled 'Webshop' answers an empty string"),
  "GET /product-feed": pub("the Google/Facebook shopping feed of published products; query validated by its matcher"),
  "GET /r/:shortCode": pub("affiliate redirect: 302 to the link's destination; counts a click, and stores visitor identifiers only with consent"),
  "GET /well-known/freeblackmarket-publishing-keys.json": pub("Ed25519 PUBLIC keys the Blackout client pins"),

  // --- /webhooks: authenticated by signature, in the handler
  // No matcher preserves this route's raw body, so today it answers 400 to
  // everything, Stripe included (seen on Postgres). The signature check is
  // what guards it on the day the raw body is wired.
  "POST /webhooks/hawala/stripe": handler("Stripe signature (STRIPE_WEBHOOK_SECRET; refused while it is unset). Dead today: 400 for want of the raw body", "achService.handleWebhook(rawBody, signature)"),
  "POST /webhooks/vendor-billing/stripe": handler("Stripe signature (STRIPE_WEBHOOK_SECRET; refused while it is unset)", ".handleWebhook("),
  "POST /webhooks/stripe-connect": handler("Stripe Connect signature (503 while STRIPE_CONNECT_WEBHOOK_SECRET is unset)", "verifyStripeConnectEvent(rawBody, signature, secret)"),
  "POST /webhooks/site-deploy": handler("HMAC-SHA256 with SITE_DEPLOY_SECRET (501 while it is unset)", "verifyDeploySignature(payload, signature)"),
  "POST /webhooks/suppliers/status": handler("per-supplier HMAC over the raw body (503 while SUPPLIER_WEBHOOK_SECRET is unset)", "verifySupplierWebhookSignature("),

  // --- /v1/admin: platform admin (`/v1/admin/**` in middlewares.ts)
  "GET /v1/admin/marketplace/attributions": ADMIN,
  "POST /v1/admin/marketplace/attributions/:id/disqualify": ADMIN,
  "GET /v1/admin/marketplace/creators": ADMIN,
  "POST /v1/admin/marketplace/creators/:seller_id/suspend": ADMIN,
  "POST /v1/admin/marketplace/payouts": ADMIN,
  "GET /v1/admin/marketplace/programs": ADMIN,
  "POST /v1/admin/marketplace/programs/:id/force-close": ADMIN,
  "GET /v1/admin/marketplace/proofs": ADMIN,
  "POST /v1/admin/marketplace/proofs/:id/reject": ADMIN,
  "POST /v1/admin/marketplace/proofs/:id/verify": ADMIN,
  "GET /v1/admin/marketplace/reward-pools": ADMIN,
  "POST /v1/admin/marketplace/reward-pools/:id/distribute": ADMIN,
  "GET /v1/admin/marketplace/service-programs": ADMIN,
  "GET /v1/admin/marketplace/subcontracts": ADMIN,
  "POST /v1/admin/marketplace/subcontracts/:id/resolve": ADMIN,

  // --- /v1/seller: a seller's bearer token and a resolved seller (`/v1/seller/**`)
  "GET /v1/seller/creator/deals": SELLER,
  "GET /v1/seller/creator/earnings": SELLER,
  "GET /v1/seller/creator/links": SELLER,
  "POST /v1/seller/creator/links": SELLER,
  "GET /v1/seller/creator/links/:id": SELLER,
  "PATCH /v1/seller/creator/links/:id": SELLER,
  "GET /v1/seller/creator/platform-accounts": SELLER,
  "POST /v1/seller/creator/platform-accounts": SELLER,
  "DELETE /v1/seller/creator/platform-accounts/:id": SELLER,
  "POST /v1/seller/creator/platform-accounts/connect": SELLER,
  "GET /v1/seller/creator/posts": SELLER,
  "POST /v1/seller/creator/posts": SELLER,
  "GET /v1/seller/creator/programs": SELLER,
  "POST /v1/seller/creator/programs/:id/apply": SELLER,
  "DELETE /v1/seller/creator/programs/:id/apply": SELLER,
  "GET /v1/seller/creator/promo-codes": SELLER,
  "POST /v1/seller/creator/promo-codes": SELLER,
  "GET /v1/seller/economic-intelligence/trends": SELLER,
  "GET /v1/seller/growth/suggestions": SELLER,
  "GET /v1/seller/launches": SELLER,
  "POST /v1/seller/launches": SELLER,
  "POST /v1/seller/listings": SELLER,
  "GET /v1/seller/listings/:id": SELLER,
  "PATCH /v1/seller/listings/:id": SELLER,
  "DELETE /v1/seller/listings/:id": SELLER,
  "POST /v1/seller/listings/:id/publish": SELLER,
  "GET /v1/seller/listings/mine": SELLER,
  "GET /v1/seller/matching/creators": SELLER,
  "GET /v1/seller/matching/opportunities": SELLER,
  "POST /v1/seller/payouts/onboarding": SELLER,
  "GET /v1/seller/payouts/status": SELLER,
  "POST /v1/seller/plugins/:slug/deprecate": SELLER,
  "GET /v1/seller/plugins/:slug/hooks": SELLER,
  "POST /v1/seller/plugins/:slug/hooks": SELLER,
  "DELETE /v1/seller/plugins/:slug/hooks/:hookId": SELLER,
  "POST /v1/seller/plugins/:slug/install": SELLER,
  "DELETE /v1/seller/plugins/:slug/install": SELLER,
  "GET /v1/seller/plugins/installed": SELLER,
  "GET /v1/seller/programs": SELLER,
  "POST /v1/seller/programs": SELLER,
  "GET /v1/seller/programs/:id": SELLER,
  "PATCH /v1/seller/programs/:id": SELLER,
  "GET /v1/seller/programs/:id/applications": SELLER,
  "POST /v1/seller/programs/:id/applications/:appId/decide": SELLER,
  "GET /v1/seller/programs/:id/deals": SELLER,
  "POST /v1/seller/programs/:id/deals/:dealId/violate": SELLER,
  "POST /v1/seller/programs/:id/publish": SELLER,
  "DELETE /v1/seller/programs/:id/publish": SELLER,
  "GET /v1/seller/programs/:id/reward-pools": SELLER,
  "POST /v1/seller/programs/:id/reward-pools": SELLER,
  "POST /v1/seller/push-tokens": SELLER,
  "DELETE /v1/seller/push-tokens": SELLER,
  "GET /v1/seller/services/applications": SELLER,
  "POST /v1/seller/services/applications": SELLER,
  "GET /v1/seller/services/contracts": SELLER,
  "POST /v1/seller/services/contracts/:id/accept": SELLER,
  "POST /v1/seller/services/contracts/:id/cancel": SELLER,
  "POST /v1/seller/services/contracts/:id/deliver": SELLER,
  "POST /v1/seller/services/contracts/:id/dispute": SELLER,
  "POST /v1/seller/services/contracts/:id/start": SELLER,
  "GET /v1/seller/services/programs": SELLER,
  "POST /v1/seller/services/programs": SELLER,
  "POST /v1/seller/services/programs/:id/applications/:appId/decide": SELLER,
  "POST /v1/seller/services/programs/:id/publish": SELLER,
  "GET /v1/seller/services/subcontracts": SELLER,
  "POST /v1/seller/services/subcontracts": SELLER,
  "POST /v1/seller/services/subcontracts/:id/accept": SELLER,
  "POST /v1/seller/services/subcontracts/:id/accept-delivery": SELLER,
  "POST /v1/seller/services/subcontracts/:id/deliver": SELLER,
  "POST /v1/seller/services/subcontracts/:id/dispute": SELLER,
  "GET /v1/seller/webhooks": SELLER,
  "POST /v1/seller/webhooks": SELLER,
  "DELETE /v1/seller/webhooks/:id": SELLER,

  // --- /v1/marketplace: public discovery, projected
  "GET /v1/marketplace/listings": pub("published plugin listings only, projected (signed bundle URL, manifest, signature)"),
  "GET /v1/marketplace/listings/:id": pub("a published plugin listing, same projection; anything else is 404"),
  "GET /v1/marketplace/programs": pub("open creator programs of the open-application types, projected by toPublicProgram"),
  "GET /v1/marketplace/programs/:id": pub("one program the list can show, the same projection plus status; a draft, an invite-only program and a missing id are one 404"),
  "GET /v1/marketplace/services": pub("open service bounties (bounty_open, throughput_pool), projected"),
  "GET /v1/marketplace/creators/:handle": pub("a creator's public profile: handle, bio, niches, follower count, social links, rating"),
  "GET /v1/marketplace/signing-keys": pub("Ed25519 PUBLIC keys that verify plugin bundles"),
  "POST /v1/marketplace/attribution/click": pub("counts a click on a short code for embeds that cannot follow /r/:shortCode; writes one click row, returns its id; a caller can inflate a click count, as with the redirect"),

  // --- /v1/checkout: the cart id is the capability, as on /store/carts/:id/complete
  "POST /v1/checkout/sessions": pub("signs a 30-minute session for a cart id the caller already holds (audience fbm-checkout, fixed claims); writes nothing"),
  "GET /v1/checkout/sessions/:id/page": handler("the signed session token in the path; ?action=complete completes that cart", "decodeSession(token)"),
  "POST /v1/checkout/sessions/:id/page": handler("the signed session token in the path; completes that cart", "decodeSession(token)"),

  // --- /v1/integrations/blackout: service credentials, in the handler
  "PUT /v1/integrations/blackout/coalitions/:coalitionId/milestones": ENTITLEMENTS,
  "POST /v1/integrations/blackout/coalitions/:coalitionId/order-cycles": ENTITLEMENTS,
  "PUT /v1/integrations/blackout/coalitions/:coalitionId/status": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/access/:mxid": ENTITLEMENTS,
  "POST /v1/integrations/blackout/entitlements/access-batch/:mxid": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/coalitions/:mxid": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/economic-standing/:mxid": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/governance-roles/:mxid": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/grants/:mxid": ENTITLEMENTS,
  "GET /v1/integrations/blackout/entitlements/summary/:mxid": ENTITLEMENTS,
  "POST /v1/integrations/blackout/reputation/events": ENTITLEMENTS,
  "POST /v1/integrations/blackout/link": handler("the same Blackout service token, checked inline; 503 while the integration is off", "verifyEntitlementsServiceToken(token)"),
  "POST /v1/integrations/blackout/oauth/token": handler("client credentials (BLACKOUT_CLIENT_ID and BLACKOUT_CLIENT_SECRET, constant-time); issues the service JWT", "verifyBlackoutCredentials(clientId, clientSecret)"),
  "GET /v1/integrations/blackout/commerce/catalog/listings": COMMERCE_KEY,
  "GET /v1/integrations/blackout/commerce/catalog/listings/:id": COMMERCE_KEY,
  "GET /v1/integrations/blackout/commerce/listings/:id/fee-quote": COMMERCE_KEY,
  "POST /v1/integrations/blackout/commerce/seller/listings": COMMERCE_KEY,
  "DELETE /v1/integrations/blackout/commerce/seller/listings/:id": COMMERCE_KEY,
  "POST /v1/integrations/blackout/commerce/seller/listings/:id/publish": COMMERCE_KEY,
  "POST /v1/integrations/blackout/commerce/seller/onboarding": COMMERCE_KEY,
  "POST /v1/integrations/blackout/commerce/checkout/sessions": COMMERCE_KEY,
  "GET /v1/integrations/blackout/commerce/checkout/sessions/:token/page": handler("a session JWT minted by the key-authenticated create (audience fbm-blackout-checkout)", "decodeToken(token)"),
  "POST /v1/integrations/blackout/commerce/checkout/sessions/:token/page": handler("the same session JWT", "decodeToken(token)"),
  "POST /v1/integrations/blackout/commerce/subscriptions/manage-sessions": COMMERCE_KEY,
  "GET /v1/integrations/blackout/commerce/subscriptions/manage-sessions/:token/page": handler("an opaque 15-minute token minted by the key-authenticated create; only its sha256 is stored", "loadLiveSession(req)"),
  "POST /v1/integrations/blackout/commerce/subscriptions/manage-sessions/:token/page": handler("the same opaque token, plus its CSRF nonce and an own-page origin", "loadLiveSession(req)"),

  // --- other machine callers
  "POST /v1/integrations/blackstar/events": handler("timestamped HMAC, per-partner key or BLACKSTAR_OUTBOUND_SECRET; 503 while FBM_BLACKSTAR_INTEGRATION is off", "verifyBlackstarSignature({"),
  "POST /v1/webhooks/content-platform/:platform": handler("per-adapter signature inside dispatchInbound; `custom` is an HMAC over the raw body with the account's secret", "cp.dispatchInbound({"),
}

/**
 * Every middleware matcher outside the four trees. A middleware can answer a
 * request itself (the `/.well-known` alias does), so a new matcher out here is
 * reviewed like a new route.
 */
const BARE_MATCHERS = [
  "/*", // security headers, every path
  "/.well-known/freeblackmarket-publishing-keys.json", // public keys, served by the middleware itself
  "/deliveries/:id/accept",
  "/deliveries/:id/claim",
  "/deliveries/:id/complete",
  "/deliveries/:id/pick-up",
  "/deliveries/:id/prepare",
  "/deliveries/:id/ready",
  "/deliveries/:id/subscribe",
  "/driver/*", // driver auth for a prefix with no route files
  "/product-feed",
  "/restaurants",
  "/tickets",
  "/v1/**",
  "/v1/admin/**",
  "/v1/seller/**",
  "/webhooks/site-deploy",
  "/webhooks/stripe-connect",
  "/webhooks/suppliers/status",
  "/webhooks/vendor-billing/stripe",
]

/**
 * Routes under /store that run the same action as a route closed out here.
 * /store asks for the publishable key and nothing else, and that key is public
 * (`/key-exchange` hands it out), so the twin of an admin-only route is
 * admin-only too. Probed with the routes above.
 */
const STORE_TWINS: Record<string, Guard> = {
  "POST /store/tickets/:id/verify": ADMIN,
}
const GUARDS: Record<string, Guard> = { ...REVIEWED, ...STORE_TWINS }

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

type WalkedRoute = { key: string; method: string; matcher: string; file: string; source: string }

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) routeFiles(abs, out)
    else if (/^route\.(ts|js)$/.test(entry.name)) out.push(abs)
  }
  return out
}

function isOutsideGuardedTrees(rel: string): boolean {
  return !GUARDED_TREES.includes(rel.split(path.sep)[0])
}

const verbDeclaration = (verb: string) =>
  new RegExp(`^export\\s+(?:const|let|var|async\\s+function|function)\\s+${verb}\\b`, "m")

/** `[id]` in a route directory is `:id` in its matcher. */
const matcherOf = (rel: string) =>
  "/" +
  path
    .dirname(rel)
    .split(path.sep)
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"))
    .join("/")

function readRouteFile(apiDir: string, rel: string): WalkedRoute[] {
  const source = fs.readFileSync(path.join(apiDir, rel), "utf8")
  const matcher = matcherOf(rel)
  // How Medusa's RoutesLoader reads a route file: one handler per exported verb.
  const methods = VERBS.filter((verb) => verbDeclaration(verb).test(source))
  const routes: WalkedRoute[] = methods.map((method) => ({ key: `${method} ${matcher}`, method, matcher, file: rel, source }))
  // A route file that exports no verb is not a reviewed nothing: say so.
  if (methods.length === 0) routes.push({ key: `(no verb) ${matcher}`, method: "", matcher, file: rel, source })
  // `export { handler as POST }` and `export * from` export verbs this walk
  // does not read. None exists; one that appears is unreviewed until the verb
  // is declared in the file.
  if (/^export\s*(\{|\*)/m.test(source)) routes.push({ key: `(re-export) ${matcher}`, method: "", matcher, file: rel, source })
  return routes
}

function walkBareRoutes(apiDir: string): WalkedRoute[] {
  return routeFiles(apiDir)
    .sort()
    .map((abs) => path.relative(apiDir, abs))
    .filter(isOutsideGuardedTrees)
    .flatMap((rel) => readRouteFile(apiDir, rel))
}

/**
 * The text of one verb's handler: from its `export` to the next top-level
 * `export`, or the end of the file. A guard named for a verb must be in here,
 * not merely somewhere in the file.
 */
function handlerSource(source: string, verb: string): string {
  const start = source.search(verbDeclaration(verb))
  if (start < 0) return ""
  const rest = source.slice(start + 1)
  const next = rest.search(/^export\s/m)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

const walked = walkBareRoutes(API_DIR)
const twins: WalkedRoute[] = Object.keys(STORE_TWINS).flatMap((key) => {
  const matcher = key.split(" ")[1]
  const rel = path.join(...matcher.slice(1).split("/").map((segment) => segment.replace(/^:(.+)$/, "[$1]")), "route.ts")
  return fs.existsSync(path.join(API_DIR, rel)) ? readRouteFile(API_DIR, rel) : []
})
/** Everything the harness below serves and probes. */
const probed = [...walked, ...twins]
const TWIN_MATCHERS = [...new Set(twins.map((r) => r.matcher))]

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

function token(actorType: string, actorId: string): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
    JWT_SECRET
  )
}

const TOKENS = {
  admin: token("user", "user_1"),
  seller: token("seller", "sel_1"),
  customer: token("customer", "cus_1"),
  restaurant: token("restaurant", "radm_1"),
  driver: token("driver", "drv_1"),
  // What `POST /auth/user/emailpass/register` hands anyone who asks: the
  // admin actor TYPE, and no actor. Not an admin.
  unregisteredUser: token("user", ""),
}
// A signed-in admin's session, as express-session would restore it from the cookie.
const ADMIN_SESSION_COOKIE = "connect.sid=bare-prefix-spec-admin"
// The session `POST /auth/session` gives a just-registered identity of the
// admin actor type (it allows unregistered actors): a type, and no actor.
const UNREGISTERED_SESSION_COOKIE = "connect.sid=bare-prefix-spec-unregistered"

let server: http.Server
let baseUrl = ""

type Probe = { status: number; reached: boolean; body: Record<string, unknown> }

async function probe(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {}
): Promise<Probe> {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : "{}",
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, reached: res.headers.get("x-sentinel-reached") === "1", body }
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
/** The route's path with every `:param` given a value. */
const concrete = (matcher: string, value = "x1") => matcher.replace(/:[A-Za-z_]+/g, value)

beforeAll(async () => {
  process.env.ADMIN_CORS = ADMIN_ORIGIN

  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader
    .getMiddlewares()
    .filter((m) => isBareMatcher(String(m.matcher)) || TWIN_MATCHERS.includes(String(m.matcher)))

  const sentinels: SentinelRoute[] = probed
    .filter((r) => r.method)
    .map((r) => ({
      isRoute: true as const,
      matcher: r.matcher,
      method: r.method,
      handler: (_req: Request, res: Response) => {
        res.setHeader("x-sentinel-reached", "1")
        res.status(200).json({ reached: `${r.method} ${r.matcher}` })
      },
    }))

  const sorted = new RoutesSorter([...loaded, ...sentinels]).sort()

  const app = express()
  app.use((req, _res, next) => {
    const scoped = req as unknown as { scope: unknown; session?: unknown }
    scoped.scope = {
      resolve(key: string) {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
          return { projectConfig: { http: { jwtSecret: JWT_SECRET } } }
        }
        throw new Error(`unexpected container key in spec: ${key}`)
      },
    }
    if ((req.headers.cookie ?? "").includes(ADMIN_SESSION_COOKIE)) {
      scoped.session = {
        auth_context: { actor_id: "user_1", actor_type: "user", auth_identity_id: "authid_user_1", app_metadata: {} },
      }
    }
    if ((req.headers.cookie ?? "").includes(UNREGISTERED_SESSION_COOKIE)) {
      scoped.session = {
        auth_context: { actor_id: "", actor_type: "user", auth_identity_id: "authid_nobody", app_metadata: {} },
      }
    }
    next()
  })

  const verbs = app as unknown as Record<string, (p: string, h: Handler) => void>
  for (const entry of sorted) {
    if ("isRoute" in entry) {
      verbs[entry.method.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    } else if (!entry.methods) {
      app.use(entry.matcher, wrapHandler(entry.handler))
    } else {
      for (const m of entry.methods) verbs[m.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    }
  }
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ message: err.message })
  })

  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
  if (ORIGINAL_ADMIN_CORS === undefined) delete process.env.ADMIN_CORS
  else process.env.ADMIN_CORS = ORIGINAL_ADMIN_CORS
})

function isBareMatcher(matcher: string): boolean {
  return !GUARDED_TREES.some((tree) => matcher === `/${tree}` || matcher.startsWith(`/${tree}/`) || matcher.startsWith(`/${tree}*`))
}

const guarded = (actors: Actor[]) =>
  probed.filter((r) => {
    const g = GUARDS[r.key]
    return g?.by === "middleware" && actors.includes(g.actor)
  })

// ---------------------------------------------------------------------------

describe("routes outside /store, /admin, /vendor and /auth", () => {
  it("the walk sees the trees it is about, so an empty walk cannot pass", () => {
    const prefixes = new Set(walked.map((r) => r.matcher.split("/")[1]))
    for (const prefix of ["restaurants", "tickets", "deliveries", "webhooks", "v1", "health"]) {
      expect(prefixes).toContain(prefix)
    }
    expect(walked.length).toBeGreaterThanOrEqual(150)
    // And it left the guarded trees alone.
    for (const tree of GUARDED_TREES) expect(prefixes).not.toContain(tree)
  })

  it("every route out here is in the reviewed list: decide who may call a new one, and add it", () => {
    const unreviewed = walked.filter((r) => !(r.key in REVIEWED)).map((r) => `${r.key}  (${r.file})`)
    expect(unreviewed).toEqual([])
  })

  it("the reviewed list names no route that is gone", () => {
    const live = new Set(walked.map((r) => r.key))
    expect(Object.keys(REVIEWED).filter((key) => !live.has(key))).toEqual([])
  })

  it("a public entry says why, and a handler-guarded route still contains its guard", () => {
    const missing: string[] = []
    for (const r of walked) {
      const g = REVIEWED[r.key]
      if (!g) continue
      if (g.by === "public" && g.why.trim().length < 20) missing.push(`${r.key}: no reason given`)
      if (g.by === "handler") {
        if (g.how.trim().length < 10) missing.push(`${r.key}: guard not described`)
        if (!handlerSource(r.source, r.method).includes(g.calls)) {
          missing.push(`${r.key}: the ${r.method} handler in ${r.file} does not contain \`${g.calls}\``)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it("a guard is looked for in its own verb's handler, not anywhere in the file", () => {
    const source = [
      "export async function GET(req, res) {",
      "  if (!requireCommerceApiKey(req, res)) return",
      "}",
      "",
      "export const POST = async (req, res) => {",
      "  res.json({})",
      "}",
    ].join("\n")
    expect(handlerSource(source, "GET")).toContain("requireCommerceApiKey(req, res)")
    expect(handlerSource(source, "POST")).not.toContain("requireCommerceApiKey(req, res)")
    expect(handlerSource(source, "POST")).toContain("res.json({})")
    expect(handlerSource(source, "DELETE")).toBe("")
  })

  it("every twin under /store of a route closed out here exists and is guarded the same way", () => {
    expect(twins.map((r) => r.key).sort()).toEqual(Object.keys(STORE_TWINS).sort())
    for (const twin of twins) {
      const bare = `${twin.method} ${twin.matcher.replace(/^\/store/, "")}`
      expect([twin.key, STORE_TWINS[twin.key]]).toEqual([twin.key, REVIEWED[bare]])
    }
  })

  it("every middleware matcher out here is a reviewed one", async () => {
    const loader = new MiddlewareFileLoader()
    await loader.scanDir(API_DIR)
    const matchers = [...new Set(loader.getMiddlewares().map((m) => String(m.matcher)).filter(isBareMatcher))].sort()
    expect(matchers).toEqual([...BARE_MATCHERS].sort())
  })
})

describe("a route a middleware guards is not reached without its actor", () => {
  it("there are guarded routes of every kind to probe", () => {
    expect(guarded(["admin"]).length).toBeGreaterThanOrEqual(22)
    expect(guarded(["seller"]).length).toBeGreaterThanOrEqual(70)
    expect(guarded(["restaurant", "driver", "restaurant-or-driver"]).length).toBe(7)
  })

  it("no credentials: 401 on every one, however the URL is spelled", async () => {
    const reached: string[] = []
    for (const r of guarded(["admin", "seller", "restaurant", "driver", "restaurant-or-driver"])) {
      const plain = concrete(r.matcher)
      const spellings = [
        plain,
        `${plain}/`,
        plain.toUpperCase(),
        // An id Express decodes before the handler sees it.
        concrete(r.matcher, "%78%31"),
        `${plain}?x=1`,
      ]
      for (const spelling of spellings) {
        const res = await probe(r.method, spelling)
        if (res.reached || res.status !== 401) reached.push(`${r.method} ${spelling} -> ${res.status}${res.reached ? " REACHED" : ""}`)
      }
    }
    expect(reached).toEqual([])
  })

  it("a re-spelled URL reaches the same handler as the plain one, so the spellings above are real doors", async () => {
    // With the admin token the sentinel answers; if Express did not route a
    // spelling to the handler, refusing it would prove nothing.
    for (const spelling of ["/restaurants/", "/RESTAURANTS", "/restaurants/%78%31/products/", "/Restaurants/x1/Admins/a1"]) {
      const method = spelling.toLowerCase().includes("admins") ? "DELETE" : spelling.includes("products") ? "POST" : "GET"
      const res = await probe(method, spelling, bearer(TOKENS.admin))
      expect([spelling, res.status, res.reached]).toEqual([spelling, 200, true])
    }
  })

  it("a percent-encoded prefix matches no route at all", async () => {
    for (const spelling of ["/%72estaurants", "/restaurants%2Fx1", "/%74ickets/x1/verify"]) {
      const res = await probe("GET", spelling, bearer(TOKENS.admin))
      expect([spelling, res.status, res.reached]).toEqual([spelling, 404, false])
    }
  })

  it("admin-only routes refuse every other actor's token, and answer an admin", async () => {
    const wrong: string[] = []
    for (const r of guarded(["admin"])) {
      for (const [who, t] of Object.entries(TOKENS)) {
        const res = await probe(r.method, concrete(r.matcher), bearer(t))
        const expectReached = who === "admin"
        if (res.reached !== expectReached || (!expectReached && res.status !== 401)) {
          wrong.push(`${r.key} as ${who} -> ${res.status}${res.reached ? " REACHED" : ""}`)
        }
      }
      // A token signed with another secret is nobody.
      const forged = jwt.sign({ actor_id: "user_1", actor_type: "user", auth_identity_id: "a" }, "not-the-secret")
      const res = await probe(r.method, concrete(r.matcher), bearer(forged))
      if (res.reached || res.status !== 401) wrong.push(`${r.key} with a forged token -> ${res.status}`)
    }
    expect(wrong).toEqual([])
  })

  it("seller routes refuse an admin, a customer, a restaurant and a driver", async () => {
    const wrong: string[] = []
    for (const r of guarded(["seller"])) {
      for (const who of ["admin", "customer", "restaurant", "driver", "unregisteredUser"] as const) {
        const res = await probe(r.method, concrete(r.matcher), bearer(TOKENS[who]))
        if (res.reached || res.status !== 401) wrong.push(`${r.key} as ${who} -> ${res.status}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("delivery routes refuse an admin, a seller and a customer, and the other delivery actor", async () => {
    const wrong: string[] = []
    for (const r of guarded(["restaurant", "driver", "restaurant-or-driver"])) {
      const g = REVIEWED[r.key] as { by: "middleware"; actor: Actor }
      const outsiders: (keyof typeof TOKENS)[] = ["admin", "seller", "customer", "unregisteredUser"]
      if (g.actor === "restaurant") outsiders.push("driver")
      if (g.actor === "driver") outsiders.push("restaurant")
      for (const who of outsiders) {
        const res = await probe(r.method, concrete(r.matcher), bearer(TOKENS[who]))
        if (res.reached || res.status !== 401) wrong.push(`${r.key} as ${who} -> ${res.status}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe("an admin's session cookie cannot be driven from another site", () => {
  // Medusa's session cookie is SameSite=None in production, so a page on
  // another origin can send it. /admin/** has carried this check; the admin
  // routes out here accept the same cookie and had none.
  const writes = () => guarded(["admin"]).filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method))

  it("there are admin writes out here, under /restaurants, /tickets (and its /store twin) and /v1/admin", () => {
    const prefixes = new Set(writes().map((r) => r.matcher.split("/").slice(1, 3).join("/")))
    expect([...prefixes].sort()).toEqual(["restaurants", "restaurants/:id", "store/tickets", "tickets/:id", "v1/admin"])
  })

  it("a cookie-authenticated write with a foreign Origin, or none, is refused", async () => {
    const through: string[] = []
    for (const r of writes()) {
      for (const origin of ["https://evil.example", undefined]) {
        const headers: Record<string, string> = { cookie: ADMIN_SESSION_COOKIE }
        if (origin) headers.origin = origin
        const res = await probe(r.method, concrete(r.matcher), headers)
        if (res.reached || res.status !== 403 || res.body.code !== "csrf_origin_rejected") {
          through.push(`${r.key} from ${origin ?? "(no origin)"} -> ${res.status}${res.reached ? " REACHED" : ""}`)
        }
      }
    }
    expect(through).toEqual([])
  })

  it("the same write from the admin panel's origin goes through, and so does a bearer token", async () => {
    const refused: string[] = []
    for (const r of writes()) {
      const fromPanel = await probe(r.method, concrete(r.matcher), { cookie: ADMIN_SESSION_COOKIE, origin: ADMIN_ORIGIN })
      if (!fromPanel.reached) refused.push(`${r.key} from the panel -> ${fromPanel.status}`)
      const byToken = await probe(r.method, concrete(r.matcher), { ...bearer(TOKENS.admin), origin: "https://evil.example" })
      if (!byToken.reached) refused.push(`${r.key} by bearer -> ${byToken.status}`)
    }
    expect(refused).toEqual([])
  })

  it("a cookie that carries no admin session is 401 from the panel's origin, and never reaches the handler", async () => {
    for (const r of guarded(["admin"])) {
      for (const cookie of ["connect.sid=somebody-else", UNREGISTERED_SESSION_COOKIE]) {
        const res = await probe(r.method, concrete(r.matcher), { cookie, origin: ADMIN_ORIGIN })
        expect([r.key, cookie, res.status, res.reached]).toEqual([r.key, cookie, 401, false])
      }
    }
  })
})
