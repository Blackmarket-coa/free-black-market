import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../modules/vendor-hype-operations-prediction/service"

type RetryExecutePayload = {
  market_id: string
  settlement_ref: string
  settlement_id: string
  retry_attempt: number
}

export default async function predictionPayoutRetryExecuteHandler({
  event,
  container,
}: SubscriberArgs<RetryExecutePayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const service = container.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  try {
    const summary = await service.processComputedPayoutsForSettlement({
      settlement_id: data.settlement_id,
      execution_run_id: `payout_retry_${Date.now()}`,
      processed_by: "retry-worker",
    })

    await eventBus.emit({
      name: "prediction.payout.processed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: data.settlement_id,
        summary,
      },
    })

    await eventBus.emit({
      name: "prediction.payout.retry_succeeded",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: data.settlement_id,
        retry_attempt: data.retry_attempt,
      },
    })
  } catch (error) {
    await eventBus.emit({
      name: "prediction.payout.processing_failed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: data.settlement_id,
        reason: error instanceof Error ? error.message : "retry_failed",
        retry_attempt: data.retry_attempt,
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: "prediction.payout.retry.execute",
}
