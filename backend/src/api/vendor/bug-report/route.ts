import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createBugReportHandler } from "../../../shared/bug-report-handler"
import type { VendorRequest } from "../types"
import { getSellerId } from "../quests/_helpers"

/**
 * The issue names the store (its `seller:` label and "Seller ID") and the
 * member who filed it. It took `_seller_id || actor_id` as the seller, and
 * behind the vendor gate the actor is a member id, so a member-id login's
 * report, most vendors', named the member as the seller (SD-145). The store
 * is resolved before the handler runs, because the handler's label and
 * context callbacks are synchronous.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (await getSellerId(req)) ?? undefined
  const memberId = (req as VendorRequest).auth_context?.actor_id
  const handler = createBugReportHandler({
    source: "vendor-panel",
    extraLabels: () => (sellerId ? [`seller:${sellerId}`] : []),
    extraContext: () => ({
      "Seller ID": sellerId,
      "Member ID": memberId,
    }),
  })
  return handler(req, res)
}
