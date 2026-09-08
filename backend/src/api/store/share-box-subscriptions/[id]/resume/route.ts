import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { resolveOwnedSubscription } from "../../_access"

// POST /store/share-box-subscriptions/:id/resume
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedSubscription(req, res)
  if (!owned) return

  if (owned.subscription.status === "cancelled") {
    // `resumeShareBoxSubscription` leaves `cancelled_at` and
    // `cancelled_reason` in place, so using it here would produce a row
    // reading `active` while still carrying why it was ended. Re-subscribing
    // goes through `reactivateShareBoxSubscription`, which clears both.
    return res.status(409).json({
      message: "This subscription is cancelled. Subscribe again to restart it.",
    })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const resumed = await service.resumeShareBoxSubscription(owned.subscription.id)
  res.json({ share_box_subscription: resumed })
}
