import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { resolveOwnedSubscription } from "../../_access"

// POST /store/share-box-subscriptions/:id/pause
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedSubscription(req, res)
  if (!owned) return

  if (owned.subscription.status === "cancelled") {
    // Pausing a cancelled subscription would flip it out of `cancelled` into
    // `paused`, quietly resurrecting it. Re-subscribing is the way back.
    return res.status(409).json({
      message: "This subscription is cancelled. Subscribe again to restart it.",
    })
  }

  const until = ((req.body ?? {}) as { until?: string }).until

  if (until !== undefined && Number.isNaN(new Date(until).getTime())) {
    return res.status(400).json({ message: "until must be a valid date" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const paused = await service.pauseShareBoxSubscription(
    owned.subscription.id,
    until ? new Date(until) : null
  )
  res.json({ share_box_subscription: paused })
}
