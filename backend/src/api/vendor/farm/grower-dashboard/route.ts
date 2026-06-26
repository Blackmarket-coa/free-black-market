import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Plant Network — Grower-node dashboard data (Section 8).
 *
 * GET /vendor/farm/grower-dashboard
 *
 * Auth/scoping: the vendor area is already seller-scoped — `api/vendor/_middlewares.ts`
 * resolves the seller id and route handlers read it off the request (see
 * `api/vendor/farm/stats/route.ts`, which uses
 * `(req as ...).auth_context?.actor_id`). This route follows the same pattern and
 * must only ever return data for the calling node.
 *
 * TODO: implement
 * 1. Resolve the seller/grower_node from auth context (same as farm/stats).
 * 2. Aggregate orders whose line items have product.metadata.grower_node === node:
 *    units_sold, gross_revenue, grower_share, pending_payout, paid_to_date
 *    (reuse GrowerPayoutService from `modules/payout-breakdown/grower-payout.ts`).
 * 3. KARMA tier via GrowerKarmaService (`modules/progression/grower-karma.ts`).
 * 4. Top 5 SKUs by revenue; last 6 months payout history.
 * 5. Return the aggregate as JSON.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (
    req as unknown as { auth_context?: { actor_id: string } }
  ).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  throw new Error("TODO: GET /vendor/farm/grower-dashboard not implemented")
}
