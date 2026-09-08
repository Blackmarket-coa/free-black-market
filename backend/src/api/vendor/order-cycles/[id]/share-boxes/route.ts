import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../_access"

/**
 * GET /vendor/order-cycles/:id/share-boxes
 *
 * The boxes generated for this cycle. Coordinator-only: each row carries
 * `customer_id` and the member's realized `items`, so a participant seller
 * listing them would be reading other members' boxes.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const access = await resolveCycleAccess(req, res, req.params.id, {
    requireCoordinator: true,
  })
  if (!access) return

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const boxes = await service.getShareBoxesForCycle(req.params.id)
    res.json({ share_boxes: boxes })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ message })
  }
}
