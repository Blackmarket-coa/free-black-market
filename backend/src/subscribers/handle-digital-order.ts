import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/handle-digital-order")
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { fulfillDigitalOrderWorkflow } from "../workflows/fulfill-digital-order"

async function digitalProductOrderCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    await fulfillDigitalOrderWorkflow(container).run({
      input: {
        id: data.id
      }
    })
  } catch (error) {
    log.error(`[digital-order] Failed to fulfill digital order ${data.id}:`, error)
    // Don't throw - subscriber failure shouldn't crash the event bus
  }
}

export default digitalProductOrderCreatedHandler

export const config: SubscriberConfig = {
  event: "digital_product_order.created",
}