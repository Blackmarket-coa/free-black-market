import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { enforceSameOriginForCookieAuth } from "../../shared/csrf-guard"

/**
 * Guards for route prefixes OUTSIDE /store, /admin, /vendor and /auth.
 *
 * Medusa applies a default only inside those trees (admin auth on /admin, the
 * publishable key and optional customer auth on /store; Mercur guards
 * /vendor). A route file anywhere else under `src/api` is reachable by anyone
 * on the internet with no token and no publishable key unless a matcher says
 * otherwise. `/restaurants` was exactly that for its whole life: an anonymous
 * caller could create a restaurant, add products to one, and delete any
 * product in the catalogue by id (SD-116).
 *
 * Every prefix listed here answers an authenticated ADMIN USER and nobody
 * else. That is the interim that needs no ruling: no client calls these
 * routes and nobody can hold the actor token they were written for (a
 * restaurant admin is only ever created by `POST /users`, which no caller can
 * pass). Who the real caller is, and whether the routes stay at all, is the
 * operator's decision; until then they are dark to the public.
 *
 * How the matcher is spelled matters. Each entry is METHOD-LESS, so Medusa
 * 2.14.2 registers it with `app.use(matcher, handler)` (`http/router.js`,
 * `registerExpressHandler`), which Express 4 matches as a path PREFIX on a
 * segment boundary, case-insensitively and with or without a trailing slash.
 * So `/restaurants`, `/restaurants/`, `/RESTAURANTS/x/products` and
 * `/restaurants/%61/products/` all pass through it, on every verb, including
 * a route file added under the prefix later. A method-scoped matcher would be
 * registered with `app[method](matcher)`, which matches the whole path only
 * and would need a second `/**` entry per verb. A percent-encoded prefix
 * (`/%72estaurants`) matches neither this nor any route, and is a 404.
 * Method-less entries are sorted ahead of every route (`routes-sorter.js`,
 * bucket "global").
 *
 * The session cookie is accepted, as on /admin, so the CSRF origin check that
 * /admin/** carries rides along: Medusa's session cookie is `SameSite=None` in
 * production, and without the check a page on another site could drive these
 * writes with a signed-in operator's cookie.
 *
 * `/tickets/:id/verify` (marks a ticket scanned) was open the same way and is
 * closed the same way: nothing says who scans at the door, and the recipe the
 * route comes from gives it to an admin user.
 *
 * `__tests__/bare-prefix-route-guards.unit.spec.ts` walks `src/api` and fails
 * when a route file outside the four trees is not in its reviewed list, or
 * when a route listed as middleware-guarded is reached without credentials.
 */
export const ADMIN_ONLY_BARE_PREFIXES = ["/restaurants", "/tickets"] as const

/**
 * A route closed above that has a twin under /store. `/store/tickets/:id/verify`
 * runs the same workflow as `/tickets/:id/verify` (it marks a ticket scanned),
 * and all /store asks for is the publishable key, which is not a credential:
 * every page of the storefront carries it and `/key-exchange` hands it to
 * anyone. Closing one door and leaving the other open would close nothing, so
 * the twin answers the same admin user. Seen on Postgres before this change:
 * 200 and the ticket "scanned" with the publishable key alone.
 */
export const ADMIN_ONLY_STORE_TWINS = ["/store/tickets/:id/verify"] as const

const adminOnly = () => [
  authenticate("user", ["bearer", "session"]),
  enforceSameOriginForCookieAuth,
]

export const barePrefixAuthMiddlewareRoutes: MiddlewareRoute[] = [
  ...[...ADMIN_ONLY_BARE_PREFIXES, ...ADMIN_ONLY_STORE_TWINS].map((prefix) => ({
    matcher: prefix,
    middlewares: adminOnly(),
  })),
  // `/v1/admin/**` already requires an admin user (bearer or session) in
  // `middlewares.ts`. The admin panel calls it with the session cookie, and it
  // had no origin check: the same forged cross-site write /admin/** refuses
  // (reward-pool distribution, force-closing a program) went through here.
  {
    matcher: "/v1/admin/**",
    middlewares: [enforceSameOriginForCookieAuth],
  },
  // Inbound content-platform webhooks are authenticated by an HMAC over the
  // raw body, which Medusa keeps only where a matcher asks for it. Nothing
  // asked here, so the `custom` adapter verified the signature of an empty
  // string (see `content-platform/service.ts`, `dispatchInbound`).
  {
    matcher: "/v1/webhooks/content-platform/:platform",
    method: "POST",
    bodyParser: { preserveRawBody: true },
  },
]
