import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/food-distribution/steps/notify-drivers")
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { createAppriseService, createDeliveryNotificationService } from "../../../services/apprise"

type NotifyDriversInput = {
  delivery_id: string
  order_id: string
  producer_id: string
  is_express?: boolean
}

/**
 * Notify available drivers about new delivery opportunity
 */
export const notifyDriversStepId = "notify-drivers-step"
export const notifyDriversStep = createStep(
  { name: notifyDriversStepId, async: false },
  async (input: NotifyDriversInput, { container }) => {
    const foodDistribution = container.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Get delivery details
    const delivery = await foodDistribution.retrieveFoodDelivery(input.delivery_id)
    if (!delivery) {
      throw new Error(`Delivery ${input.delivery_id} not found`)
    }

    // Get producer details
    const producer = await foodDistribution.retrieveFoodProducer(input.producer_id)

    // Log event
    await foodDistribution.logDeliveryEvent(input.delivery_id, {
      event_type: "notification",
      description: "Notifying available drivers about new delivery",
      metadata: {
        order_id: input.order_id,
        is_express: input.is_express,
      },
    })

    // Send notification via Apprise
    if (process.env.APPRISE_API_URL) {
      try {
        const apprise = createAppriseService()
        const deliveryNotifications = createDeliveryNotificationService(apprise)

        const notificationData = {
          deliveryId: input.delivery_id,
          deliveryNumber: delivery.delivery_number,
          orderId: input.order_id,
          restaurantName: producer?.name || "Producer",
          restaurantAddress: delivery.pickup_address,
          customerAddress: delivery.delivery_address,
          estimatedTime: delivery.estimated_delivery_at 
            ? new Date(delivery.estimated_delivery_at).toLocaleTimeString()
            : undefined,
        }

        if (input.is_express) {
          await deliveryNotifications.notifyExpressDelivery(notificationData)
        } else {
          await deliveryNotifications.notifyNewDeliveryAvailable(notificationData)
        }

        log.info(`[NotifyDrivers] Sent notification for delivery ${input.delivery_id}`)
      } catch (error) {
        log.error("[NotifyDrivers] Apprise notification failed:", error)
        // Don't fail the step if notification fails
      }
    }

    return new StepResponse({
      notified: true,
      delivery_id: input.delivery_id,
    })
  }
)
