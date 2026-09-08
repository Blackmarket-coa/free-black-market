import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../../../modules/order-cycle"
import OrderCycleModuleService from "../../../../../../../modules/order-cycle/service"
import { resolveOwnedShareBox, guardTransition } from "../../_access"

/**
 * POST /vendor/order-cycles/:id/share-boxes/:boxId/pack
 *
 * `markShareBoxPacked` writes `status` unconditionally, so the transition is checked
 * against the service's lifecycle table first — see `SHARE_BOX_TRANSITIONS`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedShareBox(req, res)
  if (!owned) return

  if (!guardTransition(res, OrderCycleModuleService, owned.box.status, "packed")) {
    return
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const updated = await service.markShareBoxPacked(owned.box.id)
  res.json({ share_box: updated })
}
