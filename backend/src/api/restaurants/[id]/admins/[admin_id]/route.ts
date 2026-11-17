import {
  AuthenticatedMedusaRequest,
  MedusaResponse
} from "@medusajs/framework"
import { 
  deleteRestaurantAdminWorkflow
} from "../../../../../workflows/restaurant/workflows/delete-restaurant-admin"
import { forbidden } from "../../../../../shared/community-read-access"
import { restaurantHasAdmin } from "../../../restaurant-scope"

/**
 * Removes an admin OF THE RESTAURANT IN THE PATH. The workflow takes only the
 * admin id, so without this check the route removed any restaurant's admin
 * whatever `:id` said (see `restaurant-scope.ts`).
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  if (!(await restaurantHasAdmin(req.scope, req.params.id, req.params.admin_id))) {
    return forbidden(res)
  }

  await deleteRestaurantAdminWorkflow(req.scope).run({
    input: {
      id: req.params.admin_id
    }
  })

  res.json({ message: "success" })
}
