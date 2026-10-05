import { 
  AuthenticatedMedusaRequest, 
  MedusaNextFunction, 
  MedusaResponse
} from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils"
import { RESTAURANT_MODULE } from "../../modules/restaurant";
import RestaurantModuleService from "../../modules/restaurant/service";
import { forbidden } from "../../shared/community-read-access";

/**
 * The caller must administer the restaurant the delivery belongs to.
 *
 * Every refusal is forbidden() (403) — a delivery that does not exist, a
 * restaurant admin that cannot be resolved, and someone else's delivery look
 * the same, so the guard is not an existence oracle over delivery ids.
 */
export const isDeliveryRestaurant = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  let allowed = false
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const restaurantModuleService: RestaurantModuleService = req.scope.resolve(
      RESTAURANT_MODULE
    )

    const restaurantAdmin = await restaurantModuleService.retrieveRestaurantAdmin(
      req.auth_context.actor_id,
      {
        relations: ["restaurant"]
      }
    )

    const { data: [delivery] } = await query.graph({
      entity: "delivery",
      fields: [
        "restaurant.*"
      ],
      filters: {
        id: req.params.id
      }
    })

    const restaurantId = restaurantAdmin?.restaurant?.id
    allowed = !!restaurantId && delivery?.restaurant?.id === restaurantId
  } catch {
    allowed = false
  }

  if (!allowed) {
    return forbidden(res)
  }

  next()
}
