import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actorId, forbidden } from "../../shared/community-read-access"

/**
 * An order set is the buyer's, and only the buyer reads it (SD-118).
 *
 * Mercur's `GET /store/order-set/:id` runs its formatting workflow over the id
 * it is handed and answers with the whole set: the buyer's customer row
 * (email, phone), the cart, the payment collection, and every order with its
 * shipping address, items and seller. Its middleware asks for no customer.
 * Measured on Postgres before this: with only the publishable key, and with
 * another customer's token, the set answered 200 with the buyer's email and
 * phone and each seller's email, phone and address.
 *
 * The storefront reads a set in one place, the signed-in account page
 * `/user/orders/[id]` (`retrieveOrderSet`), which redirects anyone who is not
 * signed in and sends the customer's token. Checkout does not: the cart
 * completion answer carries the new set itself, and the confirmation page
 * reads `GET /store/orders/:id`. So the route can require its buyer without
 * breaking a page.
 *
 * No customer token: 401, from Medusa's `authenticate`. A token, and the set
 * is someone else's or does not exist: 403 for both (`forbidden`), so the
 * answer does not say which ids exist. The list, `GET /store/order-set`,
 * already filters on the caller, but read `req.auth_context.actor_id` on a
 * call with no customer and answered 500; it now answers 401.
 */
export async function requireOrderSetBuyer(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const customerId = actorId(req)
  const id = req.params?.id
  if (!customerId || !id) return forbidden(res)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_set",
    fields: ["id", "customer_id"],
    filters: { id },
  })
  // `customerId` is never empty here, so a set with no buyer on record is refused too.
  if ((data[0] as { customer_id?: string | null } | undefined)?.customer_id !== customerId) return forbidden(res)
  next()
}

const customerOnly = authenticate("customer", ["bearer", "session"])

export const storeOrderSetOwnerMiddlewares: MiddlewareRoute[] = [
  { method: ["GET"], matcher: "/store/order-set", middlewares: [customerOnly] },
  { method: ["GET"], matcher: "/store/order-set/:id", middlewares: [customerOnly, requireOrderSetBuyer] },
]
