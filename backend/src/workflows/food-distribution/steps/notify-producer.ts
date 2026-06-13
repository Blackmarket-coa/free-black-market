import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/food-distribution/steps/notify-producer")
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { createAppriseService } from "../../../services/apprise"

type NotifyProducerInput = {
  delivery_id: string
  producer_id: string
  order_id: string
}

export const notifyProducerStepId = "notify-producer-step"
export const notifyProducerStep = createStep(
  { name: notifyProducerStepId, async: false },
  async (input: NotifyProducerInput, { container }) => {
    const foodDistribution = container.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Get producer details
    const producer = await foodDistribution.retrieveFoodProducer(input.producer_id)
    if (!producer) {
      throw new Error(`Producer ${input.producer_id} not found`)
    }

    // Log event
    await foodDistribution.logDeliveryEvent(input.delivery_id, {
      event_type: "notification",
      description: `Notification sent to producer: ${producer.name}`,
      metadata: {
        producer_id: input.producer_id,
        order_id: input.order_id,
        notification_type: "new_order",
      },
    })

    // Send notification via Apprise
    if (process.env.APPRISE_API_URL) {
      try {
        const apprise = createAppriseService()
        
        // Build notification URLs for this producer
        const notificationUrls: string[] = []
        
        // Add email if available
        if (producer.email) {
          // Uses SMTP settings from Apprise config
          notificationUrls.push(`mailto://${producer.email}`)
        }
        
        // Send notification
        if (notificationUrls.length > 0 || process.env.APPRISE_CONFIG_KEY) {
          await apprise.notify({
            title: "🛒 New Order Received!",
            body: `You have a new order #${input.order_id.slice(-8)} waiting to be prepared.\n\nPlease check your dashboard to view order details and start preparation.`,
            type: "info",
            tag: "producers",
          }, notificationUrls.length > 0 ? notificationUrls : undefined)
        }
      } catch (error) {
        log.error("[NotifyProducer] Apprise notification failed:", error)
        // Don't fail the step if notification fails
      }
    }

    return new StepResponse({
      notified: true,
      producer_name: producer.name,
      producer_email: producer.email,
    })
  }
)
