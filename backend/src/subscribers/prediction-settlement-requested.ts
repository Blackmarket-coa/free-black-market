import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { createHash } from "crypto"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../modules/vendor-hype-operations-prediction/service"

type SettlementRequestedPayload = {
  market_id: string
  settlement_ref: string
  oracle_outcome_key: string
  oracle_evidence_uri: string
  oracle_payload: Record<string, unknown>
  oracle_signature: string
  dispute_window_ends_at?: string
  execution_run_id: string
  requested_by: string
}

function validateOracleSignature(payload: Record<string, unknown>, signature: string) {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  return signature.endsWith(digest.slice(-8))
}

export default async function predictionSettlementRequestedHandler({
  event,
  container,
}: SubscriberArgs<SettlementRequestedPayload>) {
  const data = event.data
  const eventBus: IEventBusModuleService = container.resolve(Modules.EVENT_BUS)
  const service = container.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  if (!validateOracleSignature(data.oracle_payload, data.oracle_signature)) {
    await eventBus.emit({
      name: "prediction.settlement.rejected",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: "invalid_oracle_signature",
      },
    })
    return
  }

  await service.settlePredictionMarket({
    market_id: data.market_id,
    settlement_ref: data.settlement_ref,
    oracle_outcome_key: data.oracle_outcome_key,
    oracle_evidence_uri: data.oracle_evidence_uri,
    dispute_window_ends_at: data.dispute_window_ends_at
      ? new Date(data.dispute_window_ends_at)
      : undefined,
    execution_run_id: data.execution_run_id,
    executed_by: "operator",
    metadata: {
      oracle_payload: data.oracle_payload,
      oracle_signature: data.oracle_signature,
    },
  })

  const [market] = await service.listPredictionMarkets({ id: data.market_id })
  const positions = await service.listPredictionPositions({ market_id: data.market_id })

  await eventBus.emit({
    name: "prediction.settlement.finalized",
    data: {
      market_id: data.market_id,
      settlement_ref: data.settlement_ref,
      oracle_outcome_key: data.oracle_outcome_key,
      winners: positions.filter((position) => position.outcome_option_key === data.oracle_outcome_key).length,
      losers: positions.filter((position) => position.outcome_option_key !== data.oracle_outcome_key).length,
      audit: {
        policy_version: market?.policy_version,
        execution_run_id: data.execution_run_id,
        settled_by: data.requested_by,
      },
    },
  })
}

export const config: SubscriberConfig = {
  event: "prediction.settlement.requested",
}
