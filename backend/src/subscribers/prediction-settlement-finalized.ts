import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../modules/vendor-hype-operations-prediction/service"

type SettlementFinalizedPayload = {
  market_id: string
  settlement_ref: string
  oracle_outcome_key: string
  audit?: {
    execution_run_id?: string
    settled_by?: string
  }
}

export default async function predictionSettlementFinalizedHandler({
  event,
  container,
}: SubscriberArgs<SettlementFinalizedPayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const service = container.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const [settlement] = await service.listPredictionSettlements({ settlement_ref: data.settlement_ref })
  if (!settlement) {
    await eventBus.emit({
      name: "prediction.payout.processing_failed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: "settlement_not_found",
      },
    })
    return
  }

  try {
    const summary = await service.processComputedPayoutsForSettlement({
      settlement_id: settlement.id,
      execution_run_id: data.audit?.execution_run_id || `payout_run_${Date.now()}`,
      processed_by: data.audit?.settled_by || "system",
    })

    await eventBus.emit({
      name: "prediction.payout.processed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlement.id,
        summary,
      },
    })
  } catch (error) {
    await eventBus.emit({
      name: "prediction.payout.processing_failed",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        settlement_id: settlement.id,
        reason: error instanceof Error ? error.message : "payout_processing_failed",
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: "prediction.settlement.finalized",
}
