import handler from "../prediction-settlement-requested"
import { verifyOracleEnvelope } from "../../modules/vendor-hype-operations-prediction/oracle-verifier"

jest.mock("../../modules/vendor-hype-operations-prediction/oracle-verifier", () => ({
  verifyOracleEnvelope: jest.fn(),
}))

describe("prediction settlement requested subscriber", () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it("emits rejection when oracle envelope verification fails", async () => {
    ;(verifyOracleEnvelope as jest.Mock).mockReturnValue({ ok: false, reason: "signature_invalid" })

    const emit = jest.fn().mockResolvedValue(undefined)
    const listOracleSigningKeys = jest.fn().mockResolvedValue([])
    const container: any = {
      resolve: (token: string) => {
        if (token === "event_bus") return { emit }
        return { listOracleSigningKeys }
      },
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          oracle_outcome_key: "YES",
          oracle_evidence_uri: "https://oracle/evidence",
          oracle_payload: { market: "m_1" },
          oracle_signature: "sig",
          oracle_key_id: "k1",
          oracle_nonce: "nonce_123456",
          oracle_timestamp: new Date(Date.now() - 1000).toISOString(),
          oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
          execution_run_id: "run_1",
          requested_by: "admin_1",
        },
      },
      container,
    } as any)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "prediction.settlement.rejected",
        data: expect.objectContaining({ reason: "signature_invalid" }),
      })
    )
  })

  it("records receipt and emits finalized event on success", async () => {
    ;(verifyOracleEnvelope as jest.Mock).mockReturnValue({ ok: true, payloadHash: "hash_1" })

    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      listOracleSigningKeys: jest.fn().mockResolvedValue([{ key_id: "k1", status: "active", public_key_pem: "pem" }]),
      recordOracleVerificationReceipt: jest.fn().mockResolvedValue({ id: "rcpt_1" }),
      settlePredictionMarket: jest.fn().mockResolvedValue({ id: "set_1" }),
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", policy_version: "phase_b_v1" }]),
      listPredictionPayoutEntries: jest.fn().mockResolvedValue([
        { is_winner: true, payout_status: "computed" },
        { is_winner: false, payout_status: "computed" },
      ]),
    }

    const container: any = {
      resolve: (token: string) => {
        if (token === "event_bus") return { emit }
        return service
      },
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          oracle_outcome_key: "YES",
          oracle_evidence_uri: "https://oracle/evidence",
          oracle_payload: { market: "m_1" },
          oracle_signature: "sig",
          oracle_key_id: "k1",
          oracle_nonce: "nonce_123456",
          oracle_timestamp: new Date(Date.now() - 1000).toISOString(),
          oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
          execution_run_id: "run_1",
          requested_by: "admin_1",
        },
      },
      container,
    } as any)

    expect(service.recordOracleVerificationReceipt).toHaveBeenCalled()
    expect(service.settlePredictionMarket).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.settlement.finalized" }))
  })

  it("emits rejection when service throws (nonce replay / dispute-window/etc)", async () => {
    ;(verifyOracleEnvelope as jest.Mock).mockReturnValue({ ok: true, payloadHash: "hash_1" })

    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      listOracleSigningKeys: jest.fn().mockResolvedValue([{ key_id: "k1", status: "active", public_key_pem: "pem" }]),
      recordOracleVerificationReceipt: jest.fn().mockRejectedValue(new Error("oracle_replay_detected_nonce_already_used")),
    }

    const container: any = {
      resolve: (token: string) => {
        if (token === "event_bus") return { emit }
        return service
      },
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          oracle_outcome_key: "YES",
          oracle_evidence_uri: "https://oracle/evidence",
          oracle_payload: { market: "m_1" },
          oracle_signature: "sig",
          oracle_key_id: "k1",
          oracle_nonce: "nonce_123456",
          oracle_timestamp: new Date(Date.now() - 1000).toISOString(),
          oracle_expires_at: new Date(Date.now() + 60_000).toISOString(),
          execution_run_id: "run_1",
          requested_by: "admin_1",
        },
      },
      container,
    } as any)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "prediction.settlement.rejected",
        data: expect.objectContaining({ reason: "oracle_replay_detected_nonce_already_used" }),
      })
    )
  })
})
