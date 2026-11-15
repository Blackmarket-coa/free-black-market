import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Refuses Medusa core's `POST /store/returns`.
 *
 * Core's route creates a return on any order whose id the caller names, with
 * nothing but a publishable key: no customer, no ownership check, and a
 * return shipping price the caller may set. The return it makes has no
 * seller–return link, so it never appears in `/vendor/returns`. Seen on a real
 * database: an anonymous call used up a whole line's returnable quantity with
 * a return its seller could not see, and the buyer's own request through
 * `/store/return-request` was then refused for lack of quantity.
 *
 * Buyers file returns through `POST /store/return-request`, which
 * authenticates the customer, checks the order is theirs and links the
 * return to the seller. Nothing in FBM calls core's route (storefront, mobile
 * and portals checked), so it answers 410 naming the route to use. Registered
 * for POST only, on the bare path; `/store/return-request` does not match it.
 */
export function refuseCoreStoreReturnCreate(
  _req: MedusaRequest,
  res: MedusaResponse
) {
  res.status(410).json({
    type: "not_allowed",
    message:
      "Returns are requested through POST /store/return-request, signed in as the customer who placed the order.",
  })
}
