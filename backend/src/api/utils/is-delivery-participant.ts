import {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaResponse
} from "@medusajs/framework";
import { DELIVERY_MODULE } from "../../modules/delivery";
import DeliveryModuleService from "../../modules/delivery/service";
import { forbidden } from "../../shared/community-read-access";
import { isDeliveryDriver } from "./is-delivery-driver";
import { isDeliveryRestaurant } from "./is-delivery-restaurant";

/**
 * The caller must be a party to THIS delivery: the admin of its restaurant (a
 * restaurant token) or its assigned driver (a driver token). Used by
 * `/deliveries/:id/subscribe`, the workflow event stream.
 *
 * A delivery with no `transaction_id` is refused too: the subscribe handler
 * passes `transactionId: delivery.transaction_id || undefined`, and a
 * subscription with no transaction id would hear EVERY handle-delivery
 * transaction, not this one's.
 *
 * Every refusal is forbidden() (403) — missing delivery, no transaction yet,
 * someone else's delivery — so the guard is not an existence oracle.
 */
export const isDeliveryParticipant = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  let transactionId: string | null | undefined = null
  try {
    const deliveryModuleService: DeliveryModuleService = req.scope.resolve(
      DELIVERY_MODULE
    )
    const delivery = await deliveryModuleService.retrieveDelivery(req.params.id)
    transactionId = delivery?.transaction_id
  } catch {
    transactionId = null
  }

  if (!transactionId) {
    return forbidden(res)
  }

  const actorType = req.auth_context?.actor_type
  if (actorType === "restaurant") {
    return isDeliveryRestaurant(req, res, next)
  }
  if (actorType === "driver") {
    return isDeliveryDriver(req, res, next)
  }
  return forbidden(res)
}
