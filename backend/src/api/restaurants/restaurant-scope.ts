import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { RESTAURANT_MODULE } from "../../modules/restaurant"
import type RestaurantModuleService from "../../modules/restaurant/service"

/**
 * What the restaurant named in a `/restaurants/:id/...` path owns.
 *
 * These routes took the id of the thing to act on from the body or from a
 * second path segment and never compared it with the restaurant in the path:
 * `DELETE /restaurants/:id/products` handed any `product_ids` to Medusa's
 * `deleteProductsWorkflow`, so the route deleted any product in the catalogue
 * (SD-116). The prefix is admin-only today, where that adds no reach; these
 * checks are what keeps the routes scoped to their own restaurant on the day
 * a narrower caller is let in.
 *
 * Callers answer every `false` with one `forbidden()`: a restaurant that does
 * not exist, a product or admin that does not exist, and one that belongs to
 * another restaurant are the same refusal, so the routes are not an existence
 * oracle over product, restaurant or admin ids.
 */

type RestaurantProductsRow = {
  id: string
  products?: ({ id?: string | null } | null)[] | null
}

/**
 * True when the restaurant exists and EVERY id in `productIds` is a product
 * linked to it. One id that is not refuses the whole request: the caller
 * deletes nothing rather than the subset that happened to be theirs.
 */
export async function restaurantOwnsEveryProduct(
  scope: MedusaContainer,
  restaurantId: string,
  productIds: string[]
): Promise<boolean> {
  if (!restaurantId) return false
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "restaurants",
    fields: ["id", "products.id"],
    filters: { id: restaurantId },
  })
  const [restaurant] = data as unknown as RestaurantProductsRow[]
  if (!restaurant) return false

  const linked = new Set<string>()
  for (const product of restaurant.products ?? []) {
    if (product?.id) linked.add(product.id)
  }
  return productIds.every((id) => linked.has(id))
}

/** True when the admin exists and belongs to the restaurant named. */
export async function restaurantHasAdmin(
  scope: MedusaContainer,
  restaurantId: string,
  adminId: string
): Promise<boolean> {
  if (!restaurantId || !adminId) return false
  const restaurants = scope.resolve<RestaurantModuleService>(RESTAURANT_MODULE)
  const admins = await restaurants.listRestaurantAdmins(
    { id: adminId, restaurant_id: restaurantId },
    { take: 1 }
  )
  return admins.length === 1
}
