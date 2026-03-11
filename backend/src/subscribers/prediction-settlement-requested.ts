import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { verifyOracleEnvelope } from "../modules/vendor-hype-operations-prediction/oracle-verifier"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../modules/vendor-hype-operations-prediction/service"

type SettlementRequestedPayload = {
  market_id: string
  settlement_ref: string
  oracle_outcome_key: string
  oracle_evidence_uri: string
  oracle_payload: Record<string, unknown>
  oracle_signature: string
  oracle_key_id: string
  oracle_nonce: string
  oracle_timestamp: string
  oracle_expires_at: string
  dispute_window_ends_at?: string
  execution_run_id: string
  requested_by: string
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

  const verification = verifyOracleEnvelope({
    payload: data.oracle_payload,
    signature: data.oracle_signature,
    keyId: data.oracle_key_id,
    algorithm: "ed25519",
    nonce: data.oracle_nonce,
    signedAt: new Date(data.oracle_timestamp),
    expiresAt: new Date(data.oracle_expires_at),
  })

  if (!verification.ok) {
    await eventBus.emit({
      name: "prediction.settlement.rejected",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: verification.reason,
      },
    })
    return
  }

  try {
    await service.recordOracleVerificationReceipt({
      market_id: data.market_id,
      settlement_ref: data.settlement_ref,
      key_id: data.oracle_key_id,
      algorithm: "ed25519",
      nonce: data.oracle_nonce,
      payload_hash: verification.payloadHash || "",
      signature: data.oracle_signature,
      signed_at: new Date(data.oracle_timestamp),
      expires_at: new Date(data.oracle_expires_at),
      signature_verified: true,
      metadata: { requested_by: data.requested_by },
    })

    const settlement = await service.settlePredictionMarket({
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
        oracle_key_id: data.oracle_key_id,
        oracle_nonce: data.oracle_nonce,
      },
    })

    const [market] = await service.listPredictionMarkets({ id: data.market_id })
    const payouts = await service.listPredictionPayoutEntries({ settlement_id: settlement.id })

    await eventBus.emit({
      name: "prediction.settlement.finalized",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        oracle_outcome_key: data.oracle_outcome_key,
        winners: payouts.filter((entry) => entry.is_winner).length,
        losers: payouts.filter((entry) => !entry.is_winner).length,
        failed_payouts: payouts.filter((entry) => entry.payout_status === "failed").length,
        audit: {
          policy_version: market?.policy_version,
          execution_run_id: data.execution_run_id,
          settled_by: data.requested_by,
        },
      },
    })
  } catch (error) {
    await eventBus.emit({
      name: "prediction.settlement.rejected",
      data: {
        market_id: data.market_id,
        settlement_ref: data.settlement_ref,
        reason: error instanceof Error ? error.message : "settlement_processing_failed",
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: "prediction.settlement.requested",
}
