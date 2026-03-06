import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../modules/vendor-hype-operations-prediction/service"
import { buildQueueEnvelope, QueueEnvelope } from "../shared/queue-runtime"
import { QUEUE_TOPICS } from "../shared/queue-topics"
import { requeueWithBackoff } from "../shared/queue-requeue-adapter"

type PayoutProcessingFailedPayload = {
  market_id: string
  settlement_ref: string
  settlement_id?: string
  reason: string
  retry_attempt?: number
}

const MAX_RETRY_ATTEMPTS = QUEUE_TOPICS.prediction_payout_processing.policy.retries
const RETRY_BACKOFF_SECONDS = QUEUE_TOPICS.prediction_payout_processing.policy.backoffSeconds

export default async function predictionPayoutProcessingFailedHandler({
  event,
  container,
}: SubscriberArgs<PayoutProcessingFailedPayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const service = container.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )
  const logger = container.resolve("logger")

  const retryAttempt = data.retry_attempt || 0

  logger.error(`prediction.payout.processing_failed ${JSON.stringify({ market_id: data.market_id, settlement_ref: data.settlement_ref, settlement_id: data.settlement_id, reason: data.reason, retry_attempt: retryAttempt, max_retry_attempts: MAX_RETRY_ATTEMPTS })}`)

  await eventBus.emit({
    name: "observability.metric.recorded",
    data: {
      metric: "prediction.payout.processing_failed",
      value: 1,
      tags: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: data.reason,
      },
    },
  })

  let settlementId = data.settlement_id
  if (!settlementId) {
    const [settlement] = await service.listPredictionSettlements({ settlement_ref: data.settlement_ref })
    settlementId = settlement?.id
  }

  if (!settlementId) {
    await eventBus.emit({
      name: "prediction.payout.dead_lettered",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: "settlement_not_found_for_retry",
      },
    })
    return
  }

  if (retryAttempt >= MAX_RETRY_ATTEMPTS) {
    await eventBus.emit({
      name: "prediction.payout.dead_lettered",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlementId,
        reason: data.reason,
        retry_attempt: retryAttempt,
      },
    })

    await eventBus.emit({
      name: "observability.incident.triggered",
      data: {
        provider: "pagerduty",
        severity: "high",
        service: "vendor-hype-prediction",
        incident_key: `prediction-payout-${data.settlement_ref}`,
        details: {
          market_id: data.market_id,
          settlement_ref: data.settlement_ref,
          settlement_id: settlementId,
          reason: data.reason,
          retry_attempt: retryAttempt,
        },
      },
    })
    return
  }

  try {
    const summary = await service.processComputedPayoutsForSettlement({
      settlement_id: settlementId,
      execution_run_id: `payout_retry_${Date.now()}`,
      processed_by: "retry-worker",
    })

    await eventBus.emit({
      name: "prediction.payout.processed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlementId,
        summary,
      },
    })

    await eventBus.emit({
      name: "prediction.payout.retry_succeeded",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlementId,
        retry_attempt: retryAttempt + 1,
      },
    })
  } catch (error) {
    await eventBus.emit({
      name: "prediction.payout.dead_lettered",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlementId,
        reason: error instanceof Error ? error.message : "retry_failed",
        retry_attempt: retryAttempt + 1,
      },
    })

    await eventBus.emit({
      name: "observability.incident.triggered",
      data: {
        provider: "pagerduty",
        severity: "high",
        service: "vendor-hype-prediction",
        incident_key: `prediction-payout-${data.settlement_ref}`,
        details: {
          market_id: data.market_id,
          settlement_ref: data.settlement_ref,
          settlement_id: settlementId,
          reason: error instanceof Error ? error.message : "retry_failed",
          retry_attempt: retryAttempt + 1,
        },
      },
    })
  }
  const retryPayload = {
    market_id: data.market_id,
    settlement_ref: data.settlement_ref,
    settlement_id: settlementId,
    retry_attempt: retryAttempt + 1,
  }

  const envelope: QueueEnvelope<typeof retryPayload> = buildQueueEnvelope(
    "prediction_payout_processing",
    retryPayload,
    retryAttempt + 1,
    `${data.settlement_ref}:${retryAttempt + 1}`
  )

  await requeueWithBackoff(envelope, RETRY_BACKOFF_SECONDS, logger)

  await eventBus.emit({
    name: "prediction.payout.retry_scheduled",
    data: {
      ...retryPayload,
      backoff_seconds: RETRY_BACKOFF_SECONDS,
      next_retry_at: new Date(Date.now() + RETRY_BACKOFF_SECONDS * 1000).toISOString(),
      dead_letter_topic: envelope.metadata.dead_letter_topic,
    },
  })
}

export const config: SubscriberConfig = {
  event: "prediction.payout.processing_failed",
}
