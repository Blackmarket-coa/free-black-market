import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"

type SubscriptionRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveShareBoxSubscription"]>
>

/**
 * The authenticated customer, or undefined.
 *
 * `/store/**` is deliberately not force-authenticated — `middlewares.ts` says
 * of the sibling buyer surface that those routes "must stay open (gating them
 * would hide pools from the very people they exist to gather)". So each store
 * route reads the caller itself and 401s only where it actually needs one.
 */
export function storeCustomerId(req: MedusaRequest): string | undefined {
  return (req as unknown as { auth_context?: { actor_id?: string } })
    .auth_context?.actor_id
}

/**
 * Resolve one subscription the caller actually owns.
 *
 * Sends the response and returns `null` on denial, so callers use:
 *
 *   const owned = await resolveOwnedSubscription(req, res)
 *   if (!owned) return
 *
 * 404 rather than 403 on a subscription belonging to someone else: a customer
 * has no business learning which subscription ids exist. Matched on
 * `customer_id` only — `customer_external_id` is the Matrix-side identity and
 * is never what a store session authenticates as, so accepting it here would
 * let a caller reach a row they did not create.
 */
export async function resolveOwnedSubscription(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<{ customerId: string; subscription: SubscriptionRecord } | null> {
  const customerId = storeCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  let subscription: SubscriptionRecord
  try {
    subscription = await service.retrieveShareBoxSubscription(req.params.id)
  } catch (_error) {
    res.status(404).json({ message: "Subscription not found" })
    return null
  }

  if (subscription.customer_id !== customerId) {
    res.status(404).json({ message: "Subscription not found" })
    return null
  }

  return { customerId, subscription }
}
