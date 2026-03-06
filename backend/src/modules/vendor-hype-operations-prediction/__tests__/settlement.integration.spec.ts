import { generateKeyPairSync, sign } from "crypto"
import predictionSettlementRequestedHandler from "../../../subscribers/prediction-settlement-requested"
import VendorHypeOperationsPredictionService from "../service"
import { buildPayloadHash } from "../oracle-verifier"
import {
  OracleSigningKeyStatus,
  PredictionMarketState,
  PredictionPayoutStatus,
  PredictionPositionStatus,
  PredictionSettlementStatus,
} from "../models"

const createInMemoryPredictionService = () => {
  const markets: any[] = [{ id: "m_1", state: PredictionMarketState.IN_REVIEW, policy_version: "phase_b_v1" }]
  const settlements: any[] = []
  const receipts: any[] = []
  const payouts: any[] = []
  const positions: any[] = [
    {
      id: "pos_1",
      market_id: "m_1",
      supporter_id: "sup_1",
      outcome_option_key: "YES",
      stake_amount: 10,
      stake_unit: "points",
      status: PredictionPositionStatus.OPEN,
      max_payout_amount: null,
    },
    {
      id: "pos_2",
      market_id: "m_1",
      supporter_id: "sup_2",
      outcome_option_key: "NO",
      stake_amount: 10,
      stake_unit: "points",
      status: PredictionPositionStatus.OPEN,
      max_payout_amount: null,
    },
  ]

  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString("utf-8")

  const service: any = {
    keys: [{ key_id: "k1", status: OracleSigningKeyStatus.ACTIVE, public_key_pem: publicPem }],
    receipts,
    settlements,
    markets,
    positions,
    payouts,

    listOracleSigningKeys: async () => service.keys,
    listOracleVerificationReceipts: async ({ nonce }: any) => receipts.filter((r) => r.nonce === nonce),
    createOracleVerificationReceipts: async (items: any[]) => {
      const created = items.map((item, idx) => ({ id: `rcpt_${receipts.length + idx + 1}`, ...item }))
      receipts.push(...created)
      return created
    },

    listPredictionMarkets: async (query: any) =>
      query?.id ? markets.filter((m) => m.id === query.id) : [...markets],
    updatePredictionMarkets: async ({ id, ...patch }: any) => {
      const target = markets.find((m) => m.id === id)
      Object.assign(target, patch)
    },

    listPredictionSettlements: async (query: any) => {
      if (query?.settlement_ref) return settlements.filter((s) => s.settlement_ref === query.settlement_ref)
      if (query?.id) return settlements.filter((s) => s.id === query.id)
      return [...settlements]
    },
    createPredictionSettlements: async (items: any[]) => {
      const created = items.map((item, idx) => ({
        id: `set_${settlements.length + idx + 1}`,
        status: PredictionSettlementStatus.FINAL,
        ...item,
      }))
      settlements.push(...created)
      return created
    },

    listPredictionPositions: async (query: any) =>
      query?.market_id ? positions.filter((p) => p.market_id === query.market_id) : [...positions],
    updatePredictionPositions: async ({ id, ...patch }: any) => {
      const target = positions.find((p) => p.id === id)
      Object.assign(target, patch)
    },

    listPredictionPayoutEntries: async (query: any) =>
      query?.settlement_id ? payouts.filter((p) => p.settlement_id === query.settlement_id) : [...payouts],
    createPredictionPayoutEntries: async (items: any[]) => {
      const created = items.map((item, idx) => ({ id: `pay_${payouts.length + idx + 1}`, ...item }))
      payouts.push(...created)
      return created
    },

    recordOracleVerificationReceipt(input: any) {
      return VendorHypeOperationsPredictionService.prototype.recordOracleVerificationReceipt.call(this, input)
    },
    settlePredictionMarket(input: any) {
      return VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(this, input)
    },
  }

  const signPayload = (payload: Record<string, unknown>) => {
    const payloadHash = buildPayloadHash(payload)
    return sign(null, Buffer.from(payloadHash), privateKey).toString("base64")
  }

  return { service, signPayload }
}

describe("prediction settlement integration", () => {
  it("handles duplicate settlement events with persisted receipt replay protection", async () => {
    const { service, signPayload } = createInMemoryPredictionService()
    const emitted: any[] = []

    const payload = { market: "m_1", outcome: "YES", version: 1 }
    const signature = signPayload(payload)

    const args: any = {
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_ref_1",
          oracle_outcome_key: "YES",
          oracle_evidence_uri: "https://oracle/evidence",
          oracle_payload: payload,
          oracle_signature: signature,
          oracle_key_id: "k1",
          oracle_nonce: "nonce_unique_123456",
          oracle_timestamp: new Date(Date.now() - 1000).toISOString(),
          oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
          execution_run_id: "run_1",
          requested_by: "admin_1",
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") {
            return {
              emit: async (evt: any) => {
                emitted.push(evt)
              },
            }
          }
          return service
        },
      },
    }

    await predictionSettlementRequestedHandler(args)
    await predictionSettlementRequestedHandler(args)

    expect(service.settlements).toHaveLength(1)
    expect(service.receipts).toHaveLength(1)
    expect(emitted.filter((e) => e.name === "prediction.settlement.finalized")).toHaveLength(1)
    expect(emitted.filter((e) => e.name === "prediction.settlement.rejected")).toHaveLength(1)
    expect(emitted.find((e) => e.name === "prediction.settlement.rejected")?.data?.reason).toBe(
      "oracle_replay_detected_nonce_already_used"
    )
  })

  it("rejects settlement when dispute window remains open", async () => {
    const { service, signPayload } = createInMemoryPredictionService()
    const emitted: any[] = []

    const payload = { market: "m_1", outcome: "YES", version: 2 }
    const signature = signPayload(payload)

    await predictionSettlementRequestedHandler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_ref_2",
          oracle_outcome_key: "YES",
          oracle_evidence_uri: "https://oracle/evidence",
          oracle_payload: payload,
          oracle_signature: signature,
          oracle_key_id: "k1",
          oracle_nonce: "nonce_unique_654321",
          oracle_timestamp: new Date(Date.now() - 1000).toISOString(),
          oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
          dispute_window_ends_at: new Date(Date.now() + 60_000).toISOString(),
          execution_run_id: "run_2",
          requested_by: "admin_1",
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") {
            return {
              emit: async (evt: any) => {
                emitted.push(evt)
              },
            }
          }
          return service
        },
      },
    } as any)

    expect(service.settlements).toHaveLength(0)
    expect(emitted).toContainEqual(
      expect.objectContaining({
        name: "prediction.settlement.rejected",
        data: expect.objectContaining({ reason: "dispute_window_open_settlement_not_allowed" }),
      })
    )
  })

  it("creates computed payouts and lets processor transition to terminal states", async () => {
    const { service } = createInMemoryPredictionService()

    await VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(service, {
      market_id: "m_1",
      settlement_ref: "set_ref_3",
      oracle_outcome_key: "YES",
      oracle_evidence_uri: "https://oracle/evidence",
      execution_run_id: "run_3",
      dispute_window_ends_at: new Date(Date.now() - 1000),
    })

    const settlementId = service.settlements[0].id
    expect(service.payouts.every((p: any) => p.payout_status === PredictionPayoutStatus.COMPUTED)).toBe(true)

    service.updatePredictionPayoutEntries = async ({ id, ...patch }: any) => {
      const target = service.payouts.find((p: any) => p.id === id)
      Object.assign(target, patch)
    }

    const summary = await VendorHypeOperationsPredictionService.prototype.processComputedPayoutsForSettlement.call(
      service,
      {
        settlement_id: settlementId,
        execution_run_id: "run_pay_1",
        processed_by: "processor",
      }
    )

    expect(summary).toEqual(
      expect.objectContaining({ settlement_id: settlementId, credited: 1, failed: 1, skipped: 0 })
    )
    expect(service.payouts.some((p: any) => p.payout_status === PredictionPayoutStatus.CREDITED)).toBe(true)
    expect(service.payouts.some((p: any) => p.payout_status === PredictionPayoutStatus.FAILED)).toBe(true)
  })
})
