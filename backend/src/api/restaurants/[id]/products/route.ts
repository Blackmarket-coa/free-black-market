import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { CreateProductWorkflowInputDTO } from "@medusajs/framework/types";
import {
  AdminCreateProduct,
} from "@medusajs/medusa/api/admin/products/validators"
import { z } from "zod";
import { 
  deleteProductsWorkflow
} from "@medusajs/medusa/core-flows";
import { createRestaurantProductsWorkflow } from "../../../../workflows/restaurant/workflows/create-restaurant-products";
import { forbidden } from "../../../../shared/community-read-access";
import { restaurantOwnsEveryProduct } from "../../restaurant-scope";

const createSchema = z.object({
  products: AdminCreateProduct().array()
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const validatedBody = createSchema.parse(req.body)

  const { result: restaurantProducts } = await createRestaurantProductsWorkflow(
    req.scope
  ).run({
    input: {
      products: validatedBody.products as CreateProductWorkflowInputDTO[],
      restaurant_id: req.params.id,
    },
  });

  return res.status(200).json({ restaurant_products: restaurantProducts });
}

const deleteSchema = z.object({
  product_ids: z.string().array(),
});

/**
 * Deletes products OF THE RESTAURANT IN THE PATH, and nothing else.
 *
 * `product_ids` used to go straight to `deleteProductsWorkflow`, so this route
 * deleted any product in the catalogue whatever `:id` said. Every id must now
 * be a product linked to this restaurant; if one is not, the whole request is
 * refused and nothing is deleted. See `restaurant-scope.ts` for why "not this
 * restaurant's" and "does not exist" are one refusal.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const validatedBody = deleteSchema.parse(req.body);
  const productIds = [...new Set(validatedBody.product_ids)];

  if (!(await restaurantOwnsEveryProduct(req.scope, req.params.id, productIds))) {
    return forbidden(res);
  }

  await deleteProductsWorkflow(req.scope).run({
    input: {
      ids: productIds,
    },
  });

  return res.status(200).json({ success: true });
}
