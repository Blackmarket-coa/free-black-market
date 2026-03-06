import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"

type PayoutProcessedPayload = {
  market_id: string
  settlement_ref: string
  settlement_id: string
  summary: {
    credited: number
    failed: number
    skipped: number
  }
}

export default async function predictionPayoutProcessedHandler({
  event,
  container,
}: SubscriberArgs<PayoutProcessedPayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const logger = container.resolve("logger")

  logger.info(`prediction.payout.processed ${JSON.stringify({ market_id: data.market_id, settlement_ref: data.settlement_ref, settlement_id: data.settlement_id, summary: data.summary })}`)

  await eventBus.emit({
    name: "observability.metric.recorded",
    data: {
      metric: "prediction.payout.processed",
      value: 1,
      tags: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
      },
      summary: data.summary,
    },
  })
}

export const config: SubscriberConfig = {
  event: "prediction.payout.processed",
}
