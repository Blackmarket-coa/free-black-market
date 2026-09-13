import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep, createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { createRentalConfigurationStep } from "./steps/create-rental-configuration"
import { updateRentalConfigurationStep } from "./steps/update-rental-configuration"
import { RENTAL_MODULE } from "../../modules/rental"

/**
 * The product fields this workflow reads, narrowed at the point the query
 * result enters it.
 *
 * `useQueryGraphStep` types its rows as the full generated `Product`, and any
 * SDK construct that consumes them — `transform`, the second `when` — has to
 * compare `(Product | WorkflowData<Product>)[]` against
 * `((Product | WorkflowData<Product>) & Product)[]`, which exhausts the
 * compiler's comparison depth (TS2321). Narrowing at each use does not help,
 * because the comparison happens when the reference is typed; the deep type has
 * to be cut where it enters. Fifty-eight of the sixty fields on `Product` are
 * unread here, so nothing is lost by saying so.
 *
 * The error surfaced only once `.medusa/` generated types existed, so neither
 * `medusa build` nor the CI typecheck job ever reported it — that gap is W3-7,
 * and this is one of the two files that had to be fixed before the job could
 * generate types and stay green.
 */
type RentalProductRow = {
  id: string
  rental_configuration?: { id: string } | null
}

type UpsertRentalConfigWorkflowInput = {
  product_id: string
  min_rental_days?: number
  max_rental_days?: number | null
  status?: "active" | "inactive"
}

export const upsertRentalConfigWorkflow = createWorkflow(
  "upsert-rental-config",
  (input: UpsertRentalConfigWorkflowInput) => {
    // Retrieve product with its rental configuration
    const { data: products } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "rental_configuration.*"],
      filters: { id: input.product_id },
      options: {
        throwIfKeyNotFound: true,
      },
    }) as unknown as { data: RentalProductRow[] }

    // Whether the product already has a rental configuration, and if so its id.
    //
    // Both come out of this one `transform`, and `products` is referenced
    // exactly once in the whole workflow. That is the fix, not a tidy-up:
    // `products` is typed `(Product | WorkflowData<Product>)[]`, and a *second*
    // reference to it in any SDK construct exhausted the compiler's comparison
    // depth (TS2321). Another `transform`, another `when` — it made no
    // difference which, and a cast did not help either, because the comparison
    // happens when the reference is typed, before any cast applies. Inside
    // `transform` the SDK has already collapsed the union, so every branch
    // below reads these plain values rather than touching `products` again.
    //
    // The error surfaced only once `.medusa/` generated types existed, so
    // neither `medusa build` nor the CI typecheck job ever reported it. That
    // gap is W3-7, and this is one of the two files that had to be fixed before
    // the job could generate types and stay green.
    const existingRentalConfig = transform({ products }, (data) => {
      const existing = data.products[0]?.rental_configuration
      return { exists: !!existing, id: existing?.id }
    })

    // If rental config doesn't exist, create it and link
    const createdConfig = when({ existingRentalConfig }, (data) => {
      return !data.existingRentalConfig.exists
    }).then(() => {
      const newConfig = createRentalConfigurationStep({
        product_id: input.product_id,
        min_rental_days: input.min_rental_days,
        max_rental_days: input.max_rental_days,
        status: input.status,
      })

      // Create link between product and rental configuration
      const linkData = transform({ newConfig, product_id: input.product_id }, (data) => {
        return [
          {
            [Modules.PRODUCT]: {
              product_id: data.product_id,
            },
            [RENTAL_MODULE]: {
              rental_configuration_id: data.newConfig.id,
            },
          },
        ]
      })

      createRemoteLinkStep(linkData)

      return newConfig
    })

    // If rental config exists, update it
    const updatedConfig = when({ existingRentalConfig }, (data) => {
      return data.existingRentalConfig.exists
    }).then(() => {
      return updateRentalConfigurationStep({
        // The `when` above has established it exists.
        id: existingRentalConfig.id!,
        min_rental_days: input.min_rental_days,
        max_rental_days: input.max_rental_days,
        status: input.status,
      })
    })

    // Return whichever config was created or updated
    const rentalConfig = transform({ updatedConfig, createdConfig }, (data) => {
      return data.updatedConfig || data.createdConfig
    })

    return new WorkflowResponse(rentalConfig)
  }
)
