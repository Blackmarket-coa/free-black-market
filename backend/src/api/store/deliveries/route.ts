import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import zod from "zod";
import { createDeliveryWorkflow } from "../../../workflows/delivery/workflows/create-delivery";
import { handleDeliveryWorkflow } from "../../../workflows/delivery/workflows/handle-delivery";
import { actorIsAnyOf, forbidden } from "../../../shared/community-read-access";

const schema = zod.object({
  cart_id: zod.string(),
  restaurant_id: zod.string(),
});

/**
 * POST /store/deliveries
 *
 * Start a restaurant delivery for a cart. The cart must be the caller's own:
 * `handleDeliveryWorkflow` turns the cart into an order (customer, items,
 * shipping and billing addresses), so before this any signed-in account could
 * place a delivery order from someone else's cart. A cart that does not exist,
 * or has no customer, is refused the same way as someone else's.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const validatedBody = schema.parse(req.body);

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [cart],
  } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id"],
    filters: { id: validatedBody.cart_id },
  });
  if (!cart || !actorIsAnyOf(req, cart.customer_id)) {
    return forbidden(res);
  }

  const { result: delivery } = await createDeliveryWorkflow(req.scope).run({
    input: {
      cart_id: validatedBody.cart_id,
      restaurant_id: validatedBody.restaurant_id,
    },
  });

  const { transaction } = await handleDeliveryWorkflow(req.scope).run({
    input: {
      delivery_id: delivery.id,
    },
  });

  return res
    .status(200)
    .json({ message: "Delivery created", delivery, transaction });
}
