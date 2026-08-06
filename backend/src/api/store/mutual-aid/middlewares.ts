import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * Reads are public — an aid board nobody can browse cannot match anyone, and
 * the projection in `lib/aid-location.ts` makes public reads safe.
 *
 * Every write is authenticated. Posting a request, offering help, taking a
 * request on, and confirming it arrived are all acts that attach to a person,
 * and the last two feed reputation.
 */
export default defineMiddlewares({
  routes: [
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
  ],
})
