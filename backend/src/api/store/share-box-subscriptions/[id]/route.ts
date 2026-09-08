import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../modules/order-cycle/service"
import { resolveOwnedSubscription } from "../_access"

// GET /store/share-box-subscriptions/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedSubscription(req, res)
  if (!owned) return
  res.json({ share_box_subscription: owned.subscription })
}

// DELETE /store/share-box-subscriptions/:id — cancel
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedSubscription(req, res)
  if (!owned) return

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  const reason =
    ((req.body ?? {}) as { reason?: string }).reason ??
    (req.query as { reason?: string }).reason

  // Cancelled, never deleted. The row is the record that this member was
  // subscribed, and the UNIQUE index on (template, customer) means re-
  // subscribing revives this row rather than making a second one.
  const cancelled = await service.cancelShareBoxSubscription(
    owned.subscription.id,
    reason
  )
  res.json({ share_box_subscription: cancelled })
}
