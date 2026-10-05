import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"

/**
 * Spread into `src/api/middlewares.ts`. This file was `middlewares.ts`, which
 * Medusa never loaded (only the root file is read), so until it was imported
 * these entries were declarations only; every handler here 401s on its own.
 *
 * Reads are public — an aid board nobody can browse cannot match anyone, and
 * the projection in `lib/aid-location.ts` makes public reads safe.
 *
 * Every write is authenticated. Posting a request, offering help, taking a
 * request on, and confirming it arrived are all acts that attach to a person,
 * and the last two feed reputation.
 */
export const mutualAidMiddlewareRoutes: MiddlewareRoute[] = [
  {
    matcher: "/store/mutual-aid/requests",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/offers",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/requests/*/match",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/requests/*/confirm",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/requests/*/withdraw",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/offers/*/withdraw",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  // The two reads that are NOT public. Everything else on this surface is
  // browsable by anyone; these return a named person's own rows, including
  // the withdrawn and expired ones the board never shows.
  {
    matcher: "/store/mutual-aid/requests/mine",
    method: "GET",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/mutual-aid/offers/mine",
    method: "GET",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
]
