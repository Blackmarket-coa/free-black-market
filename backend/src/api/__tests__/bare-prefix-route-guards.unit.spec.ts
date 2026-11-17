import { spawnSync } from "child_process"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import ts from "typescript"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HTTP_METHODS } from "@medusajs/framework/http"
import type { RouteVerb } from "@medusajs/framework/http"
import { readRouteFileExports } from "./route-file-exports"

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
 *      style of `lib/customer-data-registry.ts` and its walk. A file's verbs
 *      are every HTTP-method name it exports, however the export is spelled
 *      (a second declarator, a destructured name, `export { a as POST }`),
 *      read from its syntax tree the way Medusa's RoutesLoader registers them
 *      (`route-file-exports.ts`); a file whose verbs cannot be read that way
 *      (`export *`, a default export) is listed as unreviewed, and REVIEWED
 *      may name verbs only, so such a file can be fixed but not reviewed;
 *   2. a route REVIEWED says a middleware guards is reached with no
 *      credentials, with the wrong actor's token, or through a re-spelled URL
 *      (re-cased, trailing slash, percent-encoded id; SD-86 and SD-87 were
 *      both raw-path matching);
 *   3. a route REVIEWED says its handler guards itself no longer contains the
 *      call named as its guard, in THAT verb's handler (a file whose GET
 *      checks and whose POST does not is the failure this is for). A verb
 *      with no declaration of its own (re-exported, imported, or bound by a
 *      destructuring pattern, whose text holds every name's handler) has no
 *      handler to read, and fails;
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
/**
 * Medusa's RoutesLoader, run by node's own CommonJS loader in a child process
 * as `medusa start` runs the build: in this process @swc/jest would compile
 * each fixture again, and it makes a top-level `this` undefined where node
 * makes it module.exports. Prints the routes it registers for a directory.
 */
const SCAN_WITH_ROUTES_LOADER = `
const [loaderPath, dir] = process.argv.slice(1)
const { RoutesLoader } = require(loaderPath)
const loader = new RoutesLoader()
loader.scanDir(dir).then(
  () => process.stdout.write("\\nROUTES " + JSON.stringify(loader.getRoutes().map(({ matcher, method }) => ({ matcher, method }))) + "\\n"),
  (error) => { console.error(error); process.exit(1) }
)`

type Handler = (req: Request, res: Response, next: NextFunction) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type SentinelRoute = { isRoute: true; matcher: string; method: string; handler: Handler }
type SortableEntry = LoadedMiddleware | SentinelRoute

const API_DIR = path.resolve(__dirname, "..")
const GUARDED_TREES = ["store", "admin", "vendor", "auth"]
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

const VERB_KEY = new RegExp(`^(${HTTP_METHODS.join("|")}) /`)
/**
 * Entries that are not a verb and a path. A `(no verb)` or `(unreadable: …)`
 * key stands for a file the walk could not read verbs from; reviewing it would
 * turn the walk green while the file's live verbs go unlisted and unprobed,
 * so the only answer to one is to fix the route file.
 */
const nonVerbKeys = (guards: Record<string, Guard>) => Object.keys(guards).filter((key) => !VERB_KEY.test(key))

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** `handler` is the text of the declaration that binds this verb's handler. */
type WalkedRoute = { key: string; method: string; matcher: string; file: string; handler: string }

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

/** `[id]` in a route directory is `:id` in its matcher. */
const matcherOf = (rel: string) =>
  "/" +
  path
    .dirname(rel)
    .split(path.sep)
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"))
    .join("/")

/**
 * The routes one route file adds: one per HTTP verb it exports, however the
 * export is spelled, as Medusa's RoutesLoader registers them
 * (`route-file-exports.ts` cites the loader).
 */
function routesOf(rel: string, text: string): WalkedRoute[] {
  const read = readRouteFileExports(rel, text)
  const matcher = matcherOf(rel)
  const routes: WalkedRoute[] = read.verbs.map((method) => ({
    key: `${method} ${matcher}`,
    method,
    matcher,
    file: rel,
    handler: read.handlerSource(method),
  }))
  // A route file that exports no verb is not a reviewed nothing: say so.
  if (read.verbs.length === 0) routes.push({ key: `(no verb) ${matcher}`, method: "", matcher, file: rel, handler: "" })
  // `export *`, a default export or a CommonJS write can register verbs that
  // no export in the file names. None exists; one that appears stays
  // unreviewed, because REVIEWED may name verbs only (nonVerbKeys), until the
  // file exports its verbs by name.
  for (const why of read.unreadable) {
    routes.push({ key: `(unreadable: ${why}) ${matcher}`, method: "", matcher, file: rel, handler: "" })
  }
  return routes
}

const readRouteFile = (apiDir: string, rel: string) => routesOf(rel, fs.readFileSync(path.join(apiDir, rel), "utf8"))

function walkBareRoutes(apiDir: string): WalkedRoute[] {
  return routeFiles(apiDir)
    .sort()
    .map((abs) => path.relative(apiDir, abs))
    .filter(isOutsideGuardedTrees)
    .flatMap((rel) => readRouteFile(apiDir, rel))
}

/** Check 1: each route a reviewed list does not name, with its file. */
const unreviewedOf = (routes: WalkedRoute[], reviewed: Record<string, Guard>): string[] =>
  routes.filter((r) => !(r.key in reviewed)).map((r) => `${r.key}  (${r.file})`)

/**
 * Check 3, and the reasons the list owes: a public entry that does not say
 * why, and a handler guard missing from THAT verb's own handler, which is
 * empty when the file does not declare it on its own (re-exported, imported,
 * or bound by a destructuring pattern beside other verbs).
 */
function entryProblems(routes: WalkedRoute[], reviewed: Record<string, Guard>): string[] {
  const missing: string[] = []
  for (const r of routes) {
    const g = reviewed[r.key]
    if (!g) continue
    if (g.by === "public" && g.why.trim().length < 20) missing.push(`${r.key}: no reason given`)
    if (g.by === "handler") {
      if (g.how.trim().length < 10) missing.push(`${r.key}: guard not described`)
      if (!r.handler.includes(g.calls)) {
        missing.push(
          r.handler
            ? `${r.key}: the ${r.method} handler in ${r.file} does not contain \`${g.calls}\``
            : `${r.key}: the ${r.method} handler is not declared on its own in ${r.file} (re-exported, imported or destructured), so its guard cannot be read`
        )
      }
    }
  }
  return missing
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
    expect(unreviewedOf(walked, REVIEWED)).toEqual([])
  })

  it("the reviewed list names no route that is gone", () => {
    const live = new Set(walked.map((r) => r.key))
    expect(Object.keys(REVIEWED).filter((key) => !live.has(key))).toEqual([])
  })

  it("the reviewed list names verbs only: a file whose verbs cannot be read is fixed, not reviewed", () => {
    expect(nonVerbKeys(GUARDS)).toEqual([])
  })

  it("a public entry says why, and a handler-guarded route still contains its guard", () => {
    expect(entryProblems(walked, REVIEWED)).toEqual([])
  })

  it("a guard is looked for in its own verb's handler, not anywhere in the file", () => {
    const source = [
      "export async function GET(req, res) {",
      "  if (!requireCommerceApiKey(req, res)) return",
      "}",
      "",
      "function helper(req) {",
      "  return verifySomething(req)",
      "}",
      "",
      "export const POST = async (req, res) => {",
      "  res.json({})",
      "}",
    ].join("\n")
    const read = readRouteFileExports("route.ts", source)
    expect(read.handlerSource("GET")).toContain("requireCommerceApiKey(req, res)")
    // The handler is its own declaration, not the text up to the next export.
    expect(read.handlerSource("GET")).not.toContain("verifySomething")
    expect(read.handlerSource("POST")).not.toContain("requireCommerceApiKey(req, res)")
    expect(read.handlerSource("POST")).toContain("res.json({})")
    expect(read.handlerSource("DELETE")).toBe("")
  })

  it("a guard is not lent by one verb of a destructuring to another: neither handler can be read, so both fail check 3", () => {
    // One pattern binds both verbs, and its text holds both handlers, so
    // GET's guard sat in the text read for an unguarded POST.
    const source = [
      "export const { GET, POST } = {",
      "  GET: async (req, res) => { if (!requireCommerceApiKey(req, res)) return; res.json({}) },",
      "  POST: async (req, res) => { res.json({ wrote: true }) },",
      "}",
    ].join("\n")
    const rel = path.join("scratch", "route.ts")
    const routes = routesOf(rel, source)
    expect(routes.map((r) => r.key)).toEqual(["GET /scratch", "POST /scratch"])
    expect(entryProblems(routes, { "GET /scratch": COMMERCE_KEY, "POST /scratch": COMMERCE_KEY })).toEqual(
      ["GET", "POST"].map(
        (verb) =>
          `${verb} /scratch: the ${verb} handler is not declared on its own in ${rel} (re-exported, imported or destructured), so its guard cannot be read`
      )
    )
  })

  describe("a file's verbs are every HTTP-method name it exports, as Medusa's RoutesLoader registers them", () => {
    /**
     * One route file per way of exporting a verb, and the verbs the loader
     * registers for it. The last case runs every one through the loader
     * itself. `./handlers` (HANDLERS) is the module the re-exports name.
     */
    const HANDLERS = ["export async function GET() {}", "export async function POST() {}", "export const PUT = async () => {}"].join("\n")
    const FORMS: Record<string, { source: string; registers: RouteVerb[] }> = {
      declarations: {
        source: ["export async function GET() {}", "export function POST() {}", "export class PUT {}"].join("\n"),
        registers: ["GET", "POST", "PUT"],
      },
      "second-declarator": {
        source: ["export async function GET() {}", "export const HEAD = GET, DELETE = async () => {}"].join("\n"),
        registers: ["GET", "DELETE", "HEAD"],
      },
      destructuring: {
        source: [
          "const handlers = { POST: async () => {}, nested: { PATCH: async () => {} }, put: async () => {} }",
          "const list = [async () => {}, null, async () => {}]",
          "export const { POST, nested: { PATCH }, put: PUT } = handlers",
          "export const [DELETE, , HEAD] = list",
        ].join("\n"),
        registers: ["POST", "PUT", "PATCH", "DELETE", "HEAD"],
      },
      renamed: {
        source: ["async function create() {}", "const remove = async () => {}", "export { create as POST, remove as DELETE }"].join("\n"),
        registers: ["POST", "DELETE"],
      },
      "re-export": { source: 'export { POST, PUT as PATCH } from "./handlers"', registers: ["POST", "PATCH"] },
      "export-star": { source: 'export * from "./handlers"', registers: ["GET", "POST", "PUT"] },
      "export-default": {
        // The loader reads this object's keys in place of the file's: POST, and not GET.
        source: ["export async function GET() {}", "export default { default: {}, POST: async () => {} }"].join("\n"),
        registers: ["POST"],
      },
      "export-equals": { source: "export = { GET: async () => {} }", registers: ["GET"] },
      commonjs: { source: ["export async function GET() {}", "exports.POST = async () => {}"].join("\n"), registers: ["GET", "POST"] },
      // CommonJS's own exports or module reached another way, or through
      // `this` at the top level: each adds POST, and none says so by name.
      "commonjs-cast": { source: ["export async function GET() {}", "(exports as any).POST = async () => {}"].join("\n"), registers: ["GET", "POST"] },
      "commonjs-non-null": { source: ["export async function GET() {}", "exports!.POST = async () => {}"].join("\n"), registers: ["GET", "POST"] },
      "commonjs-alias": {
        source: ["export async function GET() {}", "const e: any = exports", "e.POST = async () => {}"].join("\n"),
        registers: ["GET", "POST"],
      },
      "commonjs-module-cast": {
        source: ["export async function GET() {}", "(module as any).exports.POST = async () => {}"].join("\n"),
        registers: ["GET", "POST"],
      },
      "commonjs-passed": {
        source: ["export async function GET() {}", "const mutate = (m: any) => { m.exports.POST = async () => {} }", "mutate(module)"].join("\n"),
        registers: ["GET", "POST"],
      },
      "commonjs-assign": {
        source: ["export async function GET() {}", "Object.assign(exports, { POST: async () => {} })"].join("\n"),
        registers: ["GET", "POST"],
      },
      "top-level-this": { source: ["export async function GET() {}", ";(this as any).POST = async () => {}"].join("\n"), registers: ["GET", "POST"] },
      // A local of that name ends where its block ends.
      "block-scoped-local": {
        source: ["export async function GET() {}", "{ const exports = {} }", "exports.POST = async () => {}"].join("\n"),
        registers: ["GET", "POST"],
      },
      // Locals named exports and module, and `this` in a class member, are
      // not CommonJS's: they add nothing, and the file reads as it is.
      "shadowed-locals": {
        source: [
          "export async function GET() {}",
          "function build(exports: Record<string, unknown>, module: { exports: Record<string, unknown> }) {",
          "  exports.POST = async () => {}",
          "  module.exports.PUT = async () => {}",
          "}",
          "build({}, { exports: {} })",
          "class Holder { run() { (this as any).PATCH = async () => {} } }",
          "new Holder().run()",
          "const { exports: copied } = { exports: {} }",
          "for (const module of [{ exports: {} }]) module.exports = { DELETE: async () => {} }",
        ].join("\n"),
        registers: ["GET"],
      },
      "no-runtime-verb": {
        source: [
          "// export const GET = async () => {}",
          "export type POST = string",
          "export interface PUT { put: true }",
          "export declare const PATCH: () => void",
          "export const get = async () => {}",
          'export const message = "export const DELETE = async () => {}"',
        ].join("\n"),
        registers: [],
      },
    }
    const read = (form: string) => readRouteFileExports("route.ts", FORMS[form].source)

    it("an exported function or class declaration", () => {
      expect(read("declarations")).toMatchObject({ verbs: ["GET", "POST", "PUT"], unreadable: [] })
    })

    it("every declarator of an exported variable statement, not only the first, each with its own handler", () => {
      const r = read("second-declarator")
      expect(r).toMatchObject({ verbs: ["GET", "DELETE", "HEAD"], unreadable: [] })
      expect(r.handlerSource("DELETE")).toBe("DELETE = async () => {}")
      expect(r.handlerSource("HEAD")).toBe("HEAD = GET")
    })

    it("every name an object or array pattern binds, nested and renamed, and none has a handler of its own", () => {
      const r = read("destructuring")
      expect(r).toMatchObject({ verbs: ["POST", "PUT", "PATCH", "DELETE", "HEAD"], unreadable: [] })
      for (const verb of r.verbs) expect([verb, r.handlerSource(verb)]).toEqual([verb, ""])
      // The pattern's text holds every name's handler: GET's guard is not POST's.
      const guarded = "async (req, res) => { if (!requireCommerceApiKey(req, res)) return }"
      for (const source of [
        `export const { GET, POST } = { GET: ${guarded}, POST: async (req, res) => { res.json({}) } }`,
        `export const [GET, POST] = [${guarded}, async (req, res) => { res.json({}) }]`,
      ]) {
        const pair = readRouteFileExports("route.ts", source)
        expect(pair.verbs).toEqual(["GET", "POST"])
        expect(pair.handlerSource("POST")).not.toContain("requireCommerceApiKey(req, res)")
        expect(pair.handlerSource("POST")).toBe("")
      }
      // A local a pattern binds, exported under a verb's name, has none either.
      const renamed = readRouteFileExports("route.ts", `const { create, remove } = { create: ${guarded}, remove: async () => {} }\nexport { remove as DELETE }`)
      expect(renamed.verbs).toEqual(["DELETE"])
      expect(renamed.handlerSource("DELETE")).toBe("")
    })

    it("export { local as VERB }, whose handler is the local's declaration", () => {
      const r = read("renamed")
      expect(r).toMatchObject({ verbs: ["POST", "DELETE"], unreadable: [] })
      expect(r.handlerSource("POST")).toBe("async function create() {}")
      expect(r.handlerSource("DELETE")).toBe("remove = async () => {}")
    })

    it("export { VERB } from another file names the verb, and its handler is not in this file", () => {
      const r = read("re-export")
      expect(r).toMatchObject({ verbs: ["POST", "PATCH"], unreadable: [] })
      expect(r.handlerSource("POST")).toBe("")
    })

    it("export * from another file is unreadable: the names are that file's", () => {
      expect(read("export-star")).toMatchObject({ verbs: [], unreadable: ['export * from "./handlers" (line 1)'] })
    })

    it("a default export, in any spelling, is unreadable: the loader can read its keys in place of the file's", () => {
      expect(read("export-default").unreadable).toEqual(["export default (line 2)"])
      expect(readRouteFileExports("route.ts", "export default async function GET() {}").unreadable).toEqual(["export default (line 1)"])
      expect(readRouteFileExports("route.ts", "const h = {}\nexport { h as default }").unreadable).toEqual(["export { ... as default } (line 2)"])
      expect(readRouteFileExports("route.ts", 'export { default } from "./handlers"').unreadable).toEqual(["export { ... as default } (line 1)"])
    })

    it("export = and a CommonJS write are unreadable", () => {
      expect(read("export-equals").unreadable).toEqual(["export = (line 1)"])
      expect(read("commonjs").unreadable).toEqual(["exports.POST (line 2)"])
      expect(readRouteFileExports("route.js", "module.exports = { GET() {} }").unreadable).toEqual(["module.exports (line 1)"])
    })

    it("CommonJS's own exports or module used as a value in any spelling, and a top-level this, are unreadable; a local of that name is not", () => {
      expect(read("commonjs-cast").unreadable).toEqual(["(exports as any).POST (line 2)"])
      expect(read("commonjs-non-null").unreadable).toEqual(["exports!.POST (line 2)"])
      expect(read("commonjs-alias").unreadable).toEqual(["exports used as a value (line 2)"])
      expect(read("commonjs-module-cast").unreadable).toEqual(["(module as any).exports (line 2)"])
      expect(read("commonjs-passed").unreadable).toEqual(["module passed to mutate (line 3)"])
      expect(read("commonjs-assign").unreadable).toEqual(["exports passed to Object.assign (line 2)"])
      expect(read("top-level-this").unreadable).toEqual(["top-level (this as any).POST (line 2)"])
      expect(read("block-scoped-local").unreadable).toEqual(["exports.POST (line 3)"])
      expect(read("shadowed-locals")).toMatchObject({ verbs: ["GET"], unreadable: [] })
      // Nor is a name in a type, which compiles to nothing.
      expect(readRouteFileExports("route.ts", "export async function GET(m: typeof module, e: typeof exports): Promise<void> {}").unreadable).toEqual([])
    })

    it("type-only and ambient exports, lower-case names, comments and strings register nothing", () => {
      expect(read("no-runtime-verb")).toMatchObject({ verbs: [], unreadable: [] })
    })

    it("a verb-named export is listed whatever its value: the loader skips one that is not a function, and the walk errs toward review", () => {
      expect(readRouteFileExports("route.ts", 'export const GET = "not a handler"').verbs).toEqual(["GET"])
    })

    it("Medusa's RoutesLoader registers exactly these verbs from each form, compiled as medusa build compiles it and loaded as medusa start loads it, and the walk reads them or refuses", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-route-exports-"))
      try {
        // tsc to CommonJS, as `medusa build` emits this package.
        const compile = (source: string) =>
          ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
          }).outputText
        for (const [form, { source }] of Object.entries(FORMS)) {
          fs.mkdirSync(path.join(dir, form))
          fs.writeFileSync(path.join(dir, form, "route.js"), compile(source))
          fs.writeFileSync(path.join(dir, form, "handlers.js"), compile(HANDLERS))
        }
        const scan = spawnSync(process.execPath, ["-e", SCAN_WITH_ROUTES_LOADER, path.join(httpDir, "routes-loader"), dir], {
          encoding: "utf8",
        })
        expect([scan.status, scan.stderr]).toEqual([0, expect.any(String)])
        const printed = /^ROUTES (.*)$/m.exec(scan.stdout)
        if (!printed) throw new Error(`the loader printed no routes: ${scan.stdout}${scan.stderr}`)
        const registered: Record<string, RouteVerb[]> = {}
        for (const route of JSON.parse(printed[1]) as { matcher: string; method: RouteVerb }[]) {
          const form = route.matcher.slice(1)
          registered[form] = [...(registered[form] ?? []), route.method]
        }

        for (const [form, { source, registers }] of Object.entries(FORMS)) {
          const loaded = HTTP_METHODS.filter((verb) => (registered[form] ?? []).includes(verb))
          expect([form, loaded]).toEqual([form, registers])
          const r = readRouteFileExports("route.ts", source)
          // A form the walk reads gives exactly the loader's verbs. A form it
          // refuses is one where the names in the file are not the loader's.
          if (r.unreadable.length === 0) expect([form, r.verbs]).toEqual([form, registers])
          else expect([form, r.verbs]).not.toEqual([form, registers])
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it("the walk lists a verb exported by destructuring or as a second declarator, so it is unreviewed until listed", () => {
      // The reviewer's scratch on /health, on a fixed source and list so a
      // change to the real route cannot move it: the regex walk saw only HEAD.
      const rel = path.join("health", "route.ts")
      const scratch = [
        "export async function GET() {}",
        "const scratchHandlers = { POST: async () => {} }",
        "export const { POST } = scratchHandlers",
        "export const HEAD = GET, DELETE = async () => {}",
      ].join("\n")
      const routes = routesOf(rel, scratch)
      expect(routes.map((r) => r.key)).toEqual(["GET /health", "POST /health", "DELETE /health", "HEAD /health"])
      const reviewedForGetAlone = { "GET /health": pub("a liveness probe, reviewed for GET and nothing else") }
      expect(unreviewedOf(routes, reviewedForGetAlone)).toEqual(
        ["POST /health", "DELETE /health", "HEAD /health"].map((key) => `${key}  (${rel})`)
      )
    })

    it("a route file whose verbs cannot be read is listed as unreviewed, and reviewing that entry is refused", () => {
      const keys = routesOf(path.join("health", "route.ts"), 'export * from "./handlers"').map((r) => r.key)
      expect(keys).toEqual(["(no verb) /health", '(unreadable: export * from "./handlers" (line 1)) /health'])
      expect(keys.filter((key) => key in REVIEWED)).toEqual([])
      // Writing the entry into the reviewed list would silence the walk while
      // the re-exported verbs stay live and unprobed; the verbs-only check
      // refuses it.
      const silenced = { ...REVIEWED, [keys[1]]: pub("re-exported handlers, reviewed as public for now") }
      expect(nonVerbKeys(silenced)).toEqual([keys[1]])
    })
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
