import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { 
  MedusaError, 
  ContainerRegistrationKeys,
  QueryContext
} from "@medusajs/framework/utils";
import { createRestaurantWorkflow } from "../../workflows/restaurant/workflows/create-restaurant";
import { restaurantListQuerySchema, restaurantSchema } from "./validation-schemas";
import { CreateRestaurant } from "../../modules/restaurant/types";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const validatedBody = restaurantSchema.parse(req.body) as CreateRestaurant;

  if (!validatedBody) {
    return MedusaError.Types.INVALID_DATA;
  }

  const { result: restaurant } = await createRestaurantWorkflow(req.scope).run({
    input: {
      restaurant: validatedBody,
    },
  });

  return res.status(200).json({ restaurant });
}

/**
 * Lists restaurants, filtered by `id`, `handle` and `is_open` only.
 *
 * Every query parameter but `currency_code` used to be handed to `query.graph`
 * as a filter. The query string is parsed into objects, so a caller chose the
 * column, the relation and the operator: `?admins[email]=…` answered whether a
 * restaurant has an admin with that address (SD-116). Anything outside the
 * allow-list is now a 400, not a filter and not silently dropped (a dropped
 * filter would answer with every restaurant).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = restaurantListQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      type: MedusaError.Types.INVALID_DATA,
      message:
        "Unsupported query. Restaurants can be filtered by id, handle and is_open; currency_code selects the price currency.",
    });
  }

  const { currency_code = "eur", is_open, ...listFilters } = parsed.data;
  const queryFilters = {
    ...listFilters,
    ...(is_open === undefined ? {} : { is_open: is_open === "true" }),
  };

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: restaurants } = await query.graph({
    entity: "restaurants",
    fields: [
      "id",
      "handle",
      "name",
      "address",
      "phone",
      "email",
      "image_url",
      "is_open",
      "products.*",
      "products.categories.*",
      "products.variants.*",
      "products.variants.calculated_price.*"
    ],
    filters: queryFilters,
    context: {
      products: {
        variants: {
          calculated_price: QueryContext({
            currency_code
          })
        }
      }
    },
  });

  return res.status(200).json({ restaurants });
}
