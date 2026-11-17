import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { FoodOrderStatus } from "../../../modules/food-distribution/models/food-order"
import { DeliveryStatus } from "../../../modules/food-distribution/models/delivery"

type AwaitDeliveryInput = {
  delivery_id: string
  order_id: string
}

/**
 * Async step that waits for courier to complete delivery.
 */
export const awaitDeliveryCompletionStepId = "await-delivery-completion-step"
export const awaitDeliveryCompletionStep = createStep(
  { name: awaitDeliveryCompletionStepId, async: true },
  async (input: AwaitDeliveryInput, { container }) => {
    const foodDistribution = container.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Update delivery status to en route
    await foodDistribution.updateDeliveryStatus(
      input.delivery_id,
      DeliveryStatus.EN_ROUTE_DELIVERY
    )

    // Log event
    await foodDistribution.logDeliveryEvent(input.delivery_id, {
      event_type: "status_change",
      new_status: "EN_ROUTE_DELIVERY",
      description: "Courier en route to delivery destination",
    })

    return new StepResponse({ waiting: true, delivery_id: input.delivery_id })
  }
)

type ConfirmDeliveryInput = {
  delivery_id: string
  order_id: string
  proof_type: string
  proof_data?: {
    photo_url?: string
    signature_url?: string
    pin_code?: string
    recipient_name?: string
    notes?: string
  }
  latitude?: number
  longitude?: number
}

/**
 * Called when courier confirms delivery completed.
 */
export const confirmDeliveryStepId = "confirm-delivery-step"
export const confirmDeliveryStep = createStep(
  { name: confirmDeliveryStepId, async: false },
  async (input: ConfirmDeliveryInput, { container }) => {
    const foodDistribution = container.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Record proof of delivery. The service refuses a submission that does
    // not meet the delivery's requirement or lacks the named type's evidence
    // (`proofOfDeliveryError`), so this step cannot record an unchecked PIN
    // as "PIN_CODE proof".
    await foodDistribution.recordProofOfDelivery(input.delivery_id, input.proof_type, {
      photoUrl: input.proof_data?.photo_url,
      signatureUrl: input.proof_data?.signature_url,
      pinCode: input.proof_data?.pin_code,
      recipientName: input.proof_data?.recipient_name,
      notes: input.proof_data?.notes,
    })

    // Update final location if provided
    if (input.latitude && input.longitude) {
      await foodDistribution.trackCourierLocation(
        input.delivery_id,
        input.latitude,
        input.longitude
      )
    }

    // Update order status
    await foodDistribution.updateFoodOrders({
      id: input.order_id,
      status: FoodOrderStatus.DELIVERED,
      delivered_at: new Date(),
    } as any)

    return new StepResponse({ delivered: true })
  }
)
