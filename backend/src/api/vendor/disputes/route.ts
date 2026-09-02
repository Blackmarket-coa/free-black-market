import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_DISPUTE_MODULE } from "../../../modules/order-dispute"
import type OrderDisputeService from "../../../modules/order-dispute/service"
import { DisputeStatus } from "../../../modules/order-dispute/resolution"

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * GET /vendor/disputes — claims raised against this vendor.
 *
 * A vendor being complained about is entitled to see it and answer before it
 * is decided; a dispute process the respondent cannot read is not a process.
 * Defaults to the live ones.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  const requested =
    typeof req.query.status === "string" ? req.query.status.trim() : null
  const status =
    requested && Object.values(DisputeStatus).includes(requested as DisputeStatus)
      ? requested
      : [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW]

  const disputes = await service.listOrderDisputes(
    { seller_id: sellerId, status },
    { order: { created_at: "ASC" } }
  )

  return res.json({ disputes, count: (disputes as unknown[]).length })
}
