import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  completeCartWorkflow,
  releaseLockStep,
  useQueryGraphStep
} from "@medusajs/medusa/core-flows"
import {
  ValidateRentalInput,
  validateRentalStep
} from "./steps/validate-rental"
import {
  CreateRentalsForOrderInput,
  createRentalsForOrderStep
} from "./steps/create-rentals-for-order"
import { requireCompletedCartOrderStep } from "../steps/require-completed-cart-order"

type CreateRentalsWorkflowInput = {
  cart_id: string
}

export const createRentalsWorkflow = createWorkflow(
  "create-rentals",
  ({ cart_id }: CreateRentalsWorkflowInput) => {
    const { data: carts } = useQueryGraphStep({
      entity: "cart",
      fields: [
        "id",
        "customer_id",
        "items.*",
        "items.variant_id",
        "items.metadata",
        "items.variant.product.rental_configuration.*",
      ],
      filters: { id: cart_id },
      options: { throwIfKeyNotFound: true },
    })

    const rentalItems = transform({ carts }, ({ carts }) => {
      const cart = carts[0]
      const rentalItemsList: Record<string, unknown>[] = []

      for (const item of cart.items || []) {
        if (!item || !item.variant) {
          continue
        }

        const rentalConfig = (item.variant as any)?.product?.rental_configuration

        // Only include items that have an active rental configuration
        if (rentalConfig && rentalConfig.status === "active") {
          const metadata = item.metadata || {}

          rentalItemsList.push({
            line_item_id: item.id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            rental_configuration: rentalConfig,
            rental_start_date: metadata.rental_start_date,
            rental_end_date: metadata.rental_end_date,
            rental_days: metadata.rental_days,
          })
        }
      }

      return rentalItemsList
    })

    acquireLockStep({
      key: cart_id,
      timeout: 2,
      ttl: 10,
    })

    const order = completeCartWorkflow.runAsStep({
      input: { id: cart_id },
    })

    // SD-53: a completion the workflow engine left unfinished hands back no
    // order id. Refused here, before the order read below runs on an id that
    // is not there or a rental is created for it; a retry gets the unpaid
    // order back and is refused the same way. Unconditional, and shared by
    // every FBM completion (steps/require-completed-cart-order).
    requireCompletedCartOrderStep({ cart_id, order_id: order.id })

    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "items.*",
        "customer_id",
        "shipping_address.*",
        "billing_address.*",
        "items.variant.product.rental_configuration.*",
      ],
      filters: { id: order.id },
      options: { throwIfKeyNotFound: true },
    }).config({ name: "retrieve-order" })

    const { data: rentals } = useQueryGraphStep({
      entity: "rental",
      fields: [
        "id",
      ],
      filters: { order_id: order.id },
    }).config({ name: "retrieve-rentals" })

    when(
      { rentals, rentalItems },
      (data) => data.rentals.length === 0 && data.rentalItems.length > 0
    )
    .then(() => {
      validateRentalStep({
        rental_items: rentalItems,
        order_id: order.id,
      } as unknown as ValidateRentalInput)
      createRentalsForOrderStep({
        order: orders[0],
      } as unknown as CreateRentalsForOrderInput)
    })

    releaseLockStep({
      key: cart_id,
    })

    return new WorkflowResponse({
      order: orders[0],
    })
  }
)
