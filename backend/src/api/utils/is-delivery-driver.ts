import { 
  AuthenticatedMedusaRequest, 
  MedusaNextFunction, 
  MedusaResponse
} from "@medusajs/framework";
import { DELIVERY_MODULE } from "../../modules/delivery";
import DeliveryModuleService from "../../modules/delivery/service";
import { forbidden } from "../../shared/community-read-access";

/**
 * The caller must be the driver assigned to the delivery.
 *
 * Every refusal is forbidden() (403): a delivery that does not exist, one with
 * no driver yet, and someone else's delivery look the same, so the guard is not
 * an existence oracle over delivery ids.
 */
export const isDeliveryDriver = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  let allowed = false
  try {
    const deliveryModuleService: DeliveryModuleService = req.scope.resolve(
      DELIVERY_MODULE
    )

    const delivery = await deliveryModuleService.retrieveDelivery(
      req.params.id,
      {
        relations: ["driver"]
      }
    )

    const driverId = delivery?.driver?.id
    allowed = !!driverId && driverId === req.auth_context.actor_id
  } catch {
    allowed = false
  }

  if (!allowed) {
    return forbidden(res)
  }

  next()
}
