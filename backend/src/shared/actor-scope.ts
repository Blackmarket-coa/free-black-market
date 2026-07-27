import type { MedusaRequest } from "@medusajs/framework/http"

/**
 * The authenticated customer id when the actor is a customer, else null.
 *
 * The community/food write routes accept any logged-in account
 * (customer/seller/driver) — see the matchers in api/middlewares.ts — but many
 * of them persist a `customer_id` / `*_by_id` taken from the request body. That
 * lets one authenticated customer act AS ANOTHER (vote, claim a harvest share,
 * log volunteer hours, join a garden as someone else). Use this to force those
 * fields to the real actor.
 *
 * Only customers are resolved here: for a seller/driver actor `actor_id` is a
 * seller/driver id, not a `cus_...`, so callers should leave the body value
 * untouched for non-customers (route-specific handling) rather than writing a
 * seller id into a customer field.
 */
export function actingCustomerId(req: MedusaRequest): string | null {
  const ctx = (req as unknown as {
    auth_context?: { actor_id?: string; actor_type?: string }
  }).auth_context
  if (ctx?.actor_type === "customer" && typeof ctx.actor_id === "string") {
    return ctx.actor_id
  }
  return null
}
