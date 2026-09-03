import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_DISPUTE_MODULE } from "../../../modules/order-dispute"
import type OrderDisputeService from "../../../modules/order-dispute/service"
import { DisputeStatus } from "../../../modules/order-dispute/resolution"

/**
 * GET /admin/disputes — the arbitration queue.
 *
 * The counterpart to `/store/orders/:id/dispute`. A buyer could not raise a
 * dispute on an ordinary order and, had they been able to, nobody could have
 * seen it: the escrow machine had arbitration transitions and no queue behind
 * them. This is the queue.
 *
 * Defaults to what is actionable — open and under review, oldest first, since
 * a dispute that has waited longest is the one most likely to have lost the
 * buyer. Pass `status` to see resolved history.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  const requested =
    typeof req.query.status === "string" ? req.query.status.trim() : null

  if (!requested) {
    const disputes = await service.queue()
    return res.json({ disputes, count: disputes.length })
  }

  if (!Object.values(DisputeStatus).includes(requested as DisputeStatus)) {
    return res.status(400).json({ message: `Unknown status ${requested}` })
  }

  const disputes = await service.listOrderDisputes(
    { status: requested },
    { order: { created_at: "ASC" } }
  )
  return res.json({ disputes, count: (disputes as unknown[]).length })
}
