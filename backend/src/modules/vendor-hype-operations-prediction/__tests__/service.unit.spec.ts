import VendorHypeOperationsPredictionService from "../service"
import {
  OracleSigningKeyStatus,
  PredictionMarketState,
  PredictionMode,
  PredictionPayoutStatus,
  PredictionPositionStatus,
  PredictionSettlementStatus,
} from "../models"

describe("VendorHypeOperationsPredictionService", () => {
  it("enforces valid prediction market state transitions", async () => {
    const ctx: any = {
      MARKET_STATE_TRANSITIONS: {
        [PredictionMarketState.DRAFT]: [PredictionMarketState.SCHEDULED],
      },
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.DRAFT }]),
      updatePredictionMarkets: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.transitionPredictionMarketState.call(
        ctx,
        "m_1",
        PredictionMarketState.OPEN
      )
    ).rejects.toThrow("Invalid prediction market transition")
  })

  it("returns existing position for same idempotency key", async () => {
    const existingPosition = { id: "pos_1" }
    const ctx: any = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.OPEN }]),
      listPredictionPositions: jest.fn().mockResolvedValueOnce([existingPosition]).mockResolvedValueOnce([]),
      ensureSupporterEligibility: jest.fn().mockResolvedValue({}),
      createPredictionPositions: jest.fn(),
      markSupporterParticipation: jest.fn().mockResolvedValue(undefined),
    }

    const result = await VendorHypeOperationsPredictionService.prototype.placePredictionPosition.call(ctx, {
      market_id: "m_1",
      supporter_id: "sup_1",
      outcome_option_key: "YES",
      stake_amount: 100,
      idempotency_key: "idem_1",
    })

    expect(result).toEqual(existingPosition)
    expect(ctx.createPredictionPositions).not.toHaveBeenCalled()
  })

  it("denies blocked policy decision for regulated cash in US", () => {
    const decision = VendorHypeOperationsPredictionService.prototype.getPolicyDecision.call(
      {
        policyService: {
          evaluateMode: (mode: PredictionMode, jurisdiction: string) => ({
            allowed: !(mode === PredictionMode.REGULATED_CASH && jurisdiction === "US"),
            reason: "disabled",
            policy_version: "phase_b_v1",
          }),
        },
      },
      { policyService: { evaluateMode: (mode: PredictionMode, jurisdiction: string) => ({
        allowed: !(mode === PredictionMode.REGULATED_CASH && jurisdiction === "US"),
        reason: "disabled",
        policy_version: "phase_b_v1",
      }) } },
      PredictionMode.REGULATED_CASH,
      "US"
    )

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("disabled")
  })

  it("is idempotent for duplicate settlement_ref and prevents finalize race", async () => {
    const existingSettlement = { id: "set_existing", settlement_ref: "ref_1" }
    const ctx: any = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.IN_REVIEW }]),
      listPredictionSettlements: jest.fn().mockResolvedValue([existingSettlement]),
    }

    const result = await VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(ctx, {
      market_id: "m_1",
      settlement_ref: "ref_1",
      oracle_outcome_key: "YES",
      oracle_evidence_uri: "https://oracle/evidence",
      execution_run_id: "run_1",
    })

    expect(result).toEqual(existingSettlement)
  })

  it("blocks settlement while dispute window is still open", async () => {
    const ctx: any = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.IN_REVIEW }]),
      listPredictionSettlements: jest.fn().mockResolvedValue([]),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(ctx, {
        market_id: "m_1",
        settlement_ref: "ref_2",
        oracle_outcome_key: "YES",
        oracle_evidence_uri: "https://oracle/evidence",
        execution_run_id: "run_2",
        dispute_window_ends_at: new Date(Date.now() + 60_000),
      })
    ).rejects.toThrow("dispute_window_open_settlement_not_allowed")
  })

  it("computes payouts and marks winners/losers on settlement", async () => {
    const settlement = { id: "set_1", status: PredictionSettlementStatus.FINAL }
    const positions = [
      {
        id: "pos_win",
        supporter_id: "sup_1",
        outcome_option_key: "YES",
        stake_amount: 10,
        stake_unit: "points",
        max_payout_amount: null,
      },
      {
        id: "pos_lose",
        supporter_id: "sup_2",
        outcome_option_key: "NO",
        stake_amount: 5,
        stake_unit: "points",
        max_payout_amount: null,
      },
    ]

    const ctx: any = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.IN_REVIEW }]),
      listPredictionSettlements: jest.fn().mockResolvedValue([]),
      createPredictionSettlements: jest.fn().mockResolvedValue([settlement]),
      listPredictionPositions: jest.fn().mockResolvedValue(positions),
      createPredictionPayoutEntries: jest.fn().mockResolvedValue(undefined),
      updatePredictionPositions: jest.fn().mockResolvedValue(undefined),
      updatePredictionMarkets: jest.fn().mockResolvedValue(undefined),
    }

    const result = await VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(ctx, {
      market_id: "m_1",
      settlement_ref: "ref_3",
      oracle_outcome_key: "YES",
      oracle_evidence_uri: "https://oracle/evidence",
      execution_run_id: "run_3",
    })

    expect(result).toEqual(settlement)
    expect(ctx.createPredictionPayoutEntries).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          position_id: "pos_win",
          payout_amount: 20,
          payout_status: PredictionPayoutStatus.COMPUTED,
          is_winner: true,
        }),
        expect.objectContaining({
          position_id: "pos_lose",
          payout_amount: 0,
          payout_status: PredictionPayoutStatus.COMPUTED,
          is_winner: false,
        }),
      ])
    )
    expect(ctx.updatePredictionPositions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pos_win", status: PredictionPositionStatus.WON })
    )
    expect(ctx.updatePredictionPositions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pos_lose", status: PredictionPositionStatus.LOST })
    )
  })

  it("reverses settlement and reopens positions", async () => {
    const settlement = { id: "set_1", status: PredictionSettlementStatus.FINAL, metadata: { previous: true } }
    const payouts = [
      { id: "pay_1", position_id: "pos_1" },
      { id: "pay_2", position_id: "pos_2" },
    ]
    const ctx: any = {
      listPredictionSettlements: jest.fn().mockResolvedValueOnce([settlement]).mockResolvedValueOnce([settlement]),
      updatePredictionSettlements: jest.fn().mockResolvedValue(undefined),
      listPredictionPayoutEntries: jest.fn().mockResolvedValue(payouts),
      updatePredictionPayoutEntries: jest.fn().mockResolvedValue(undefined),
      updatePredictionPositions: jest.fn().mockResolvedValue(undefined),
      updatePredictionMarkets: jest.fn().mockResolvedValue(undefined),
    }

    await VendorHypeOperationsPredictionService.prototype.reverseSettlement.call(ctx, {
      settlement_id: "set_1",
      market_id: "m_1",
      reason: "oracle correction",
      execution_run_id: "run_r1",
      actor_id: "admin_1",
    })

    expect(ctx.updatePredictionPayoutEntries).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pay_1", payout_status: PredictionPayoutStatus.REVERSED })
    )
    expect(ctx.updatePredictionPositions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pos_1", status: PredictionPositionStatus.OPEN })
    )
    expect(ctx.updatePredictionMarkets).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m_1", state: PredictionMarketState.IN_REVIEW })
    )
  })

  it("blocks supporter with active self exclusion", async () => {
    const ctx: any = {
      listUserPredictionSafeties: jest.fn().mockResolvedValue([
        { supporter_id: "sup_1", self_excluded_until: new Date(Date.now() + 60_000) },
      ]),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.ensureSupporterEligibility.call(ctx, "sup_1")
    ).rejects.toThrow("self_exclusion_active")
  })

  it("blocks supporter with active cooldown", async () => {
    const ctx: any = {
      listUserPredictionSafeties: jest.fn().mockResolvedValue([
        {
          supporter_id: "sup_1",
          self_excluded_until: null,
          cooldown_until: new Date(Date.now() + 60_000),
          daily_counter_date: new Date().toISOString().slice(0, 10),
          daily_positions_count: 0,
          daily_position_limit: 5,
        },
      ]),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.ensureSupporterEligibility.call(ctx, "sup_1")
    ).rejects.toThrow("cooldown_active")
  })

  it("rejects oracle nonce replay", async () => {
    const ctx: any = {
      listOracleSigningKeys: jest.fn().mockResolvedValue([{ key_id: "k1", status: OracleSigningKeyStatus.ACTIVE }]),
      listOracleVerificationReceipts: jest.fn().mockResolvedValue([{ id: "r1" }]),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.recordOracleVerificationReceipt.call(ctx, {
        market_id: "m_1",
        settlement_ref: "set_1",
        key_id: "k1",
        algorithm: "ed25519",
        nonce: "nonce_123456",
        payload_hash: "hash",
        signature: "sig",
        signed_at: new Date(Date.now() - 1000),
        expires_at: new Date(Date.now() + 1000),
        signature_verified: true,
      })
    ).rejects.toThrow("oracle_replay_detected_nonce_already_used")
  })

  it("fails key rotation if old key does not exist", async () => {
    const ctx: any = {
      listOracleSigningKeys: jest.fn().mockResolvedValue([]),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.rotateOracleSigningKey.call(ctx, {
        old_key_id: "old",
        new_key_id: "new",
        new_public_key_pem: "pem",
        rotation_note: "rotate",
      })
    ).rejects.toThrow("old_key_not_found")
  })
})
