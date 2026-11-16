import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_DISPUTE_MODULE } from "../../../modules/order-dispute"
import type OrderDisputeService from "../../../modules/order-dispute/service"
import { DisputeStatus } from "../../../modules/order-dispute/resolution"
import { toVendorDisputeView } from "../../../modules/order-dispute/views"
import { requireSellerId } from "../../../shared/auth-helpers"

/**
 * GET /vendor/disputes — claims raised against this vendor.
 *
 * A vendor being complained about is entitled to see it and answer before it
 * is decided; a dispute process the respondent cannot read is not a process.
 * Defaults to the live ones.
 *
 * The seller is resolved with `requireSellerId`, which maps a vendor login's
 * member (mem_*) to its seller (sel_*), the id `order_dispute.seller_id`
 * holds. This route used `auth_context.actor_id` as the seller id, which
 * for a vendor login is the member id (SD-74 found the same in the analytics
 * routes), so every vendor's list was empty.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  const requested =
    typeof req.query.status === "string" ? req.query.status.trim() : null
  const status =
    requested && Object.values(DisputeStatus).includes(requested as DisputeStatus)
      ? requested
      : [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW]

  const rows = (await service.listOrderDisputes(
    { seller_id: sellerId, status },
    { order: { created_at: "ASC" } }
  )) as unknown[]
  const disputes = rows.map(toVendorDisputeView)

  return res.json({ disputes, count: disputes.length })
}
