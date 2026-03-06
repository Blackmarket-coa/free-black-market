import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"

type RetryScheduledPayload = {
  market_id: string
  settlement_ref: string
  settlement_id: string
  retry_attempt: number
  backoff_seconds: number
  next_retry_at: string
  dead_letter_topic: string
}

export default async function predictionPayoutRetryScheduledHandler({
  event,
  container,
}: SubscriberArgs<RetryScheduledPayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const logger = container.resolve("logger")

  logger.info(
    `prediction.payout.retry_scheduled ${JSON.stringify({
      settlement_ref: data.settlement_ref,
      retry_attempt: data.retry_attempt,
      next_retry_at: data.next_retry_at,
      dead_letter_topic: data.dead_letter_topic,
    })}`
  )

  setTimeout(async () => {
    await eventBus.emit({
      name: "prediction.payout.retry.execute",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: data.settlement_id,
        retry_attempt: data.retry_attempt,
      },
    })
  }, Math.max(1, data.backoff_seconds) * 1000)
}

export const config: SubscriberConfig = {
  event: "prediction.payout.retry_scheduled",
}
