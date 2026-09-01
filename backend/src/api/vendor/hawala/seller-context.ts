import type { MedusaRequest } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import { resolveSellerId } from "../../../shared/listing-type-guard"

/**
 * Resolve the SELLER id behind a vendor request on the hawala surface.
 *
 * `api/vendor/_middlewares.ts` deliberately rewrites `auth_context.actor_id`
 * from `sel_*` to `mem_*` for MercurJS compatibility, and installs a property
 * setter to keep it rewritten. Earnings, however, accrue under `sel_*` (see
 * `subscribers/hawala-order-payment.ts`). Every route on this surface that
 * read `auth_context.actor_id` directly was therefore looking up money under
 * an id it never accrues to:
 *
 *   - `payouts` threw "Vendor account not found" and no payout was possible;
 *   - `earnings` was worse — it CREATED the missing account, silently minting
 *     a second, permanently-empty SELLER_EARNINGS row owned by `mem_*` and
 *     showing the vendor a $0 balance next to real earnings they could not see.
 *
 * `_seller_id` is what the seller-context guard attaches; fall back to the
 * actor id and resolve a `mem_*` through the `member` table.
 */
export async function resolveVendorSellerId(
  req: MedusaRequest
): Promise<string | undefined> {
  const vendorReq = req as VendorRequest
  const actorId = vendorReq._seller_id || vendorReq.auth_context?.actor_id
  return resolveSellerId(req, actorId)
}
