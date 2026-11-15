import { MedusaError } from "@medusajs/framework/utils"
import VendorHypeOperationsPredictionService, { MARKET_STATE_TRANSITIONS } from "../service"
import { PREDICTION_MODE_NOT_PERMITTED, PredictionPolicyService } from "../policy-service"
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

  // The real lifecycle map and the real policy, not stubs: these pin what the
  // operator route can and cannot do. The market is one the policy admits
  // (non-cash in the US) unless a test says otherwise.
  const transitionCtx = (
    state: PredictionMarketState | null,
    market: { mode: PredictionMode; jurisdiction_code: string } = {
      mode: PredictionMode.NON_CASH,
      jurisdiction_code: "US",
    }
  ) => ({
    MARKET_STATE_TRANSITIONS,
    policyService: new PredictionPolicyService(),
    listPredictionMarkets: jest.fn().mockResolvedValue(state ? [{ id: "m_1", state, ...market }] : []),
    updatePredictionMarkets: jest.fn().mockResolvedValue(undefined),
  })
  const transition = (ctx: ReturnType<typeof transitionCtx>, id: string, next: PredictionMarketState) =>
    VendorHypeOperationsPredictionService.prototype.transitionPredictionMarketState.call(
      ctx as never,
      id,
      next
    )

  it("never moves a market to SETTLED, even from IN_REVIEW where the lifecycle allows it", async () => {
    // The lifecycle does list in_review -> settled; settlement is the only
    // thing that may perform it, because only settlement writes the
    // settlement record and payouts.
    expect(MARKET_STATE_TRANSITIONS[PredictionMarketState.IN_REVIEW]).toContain(
      PredictionMarketState.SETTLED
    )
    const ctx = transitionCtx(PredictionMarketState.IN_REVIEW)

    const err = await transition(ctx, "m_1", PredictionMarketState.SETTLED).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MedusaError)
    expect((err as MedusaError).type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(ctx.updatePredictionMarkets).not.toHaveBeenCalled()
  })

  it("types an unknown market NOT_FOUND, so the HTTP layer answers 404", async () => {
    const ctx = transitionCtx(null)

    const err = await transition(ctx, "m_missing", PredictionMarketState.SCHEDULED).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MedusaError)
    expect((err as MedusaError).type).toBe(MedusaError.Types.NOT_FOUND)
  })

  it("types an illegal transition NOT_ALLOWED, so the HTTP layer answers 400", async () => {
    const ctx = transitionCtx(PredictionMarketState.DRAFT)

    const err = await transition(ctx, "m_1", PredictionMarketState.OPEN).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MedusaError)
    expect((err as MedusaError).type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(ctx.updatePredictionMarkets).not.toHaveBeenCalled()
  })

  it.each([
    [PredictionMarketState.DRAFT, PredictionMarketState.SCHEDULED],
    [PredictionMarketState.LOCKED, PredictionMarketState.IN_REVIEW],
    [PredictionMarketState.IN_REVIEW, PredictionMarketState.VOIDED],
  ])("still performs the operator transition %s -> %s", async (from, to) => {
    const ctx = transitionCtx(from)

    await transition(ctx, "m_1", to)

    expect(ctx.updatePredictionMarkets).toHaveBeenCalledWith({ id: "m_1", state: to })
  })

  // SD-76 follow-up: only creation consulted the policy, so a market admitted
  // under the old block list (sweepstakes in the US, before 316f01b) could
  // still be published and opened.
  const legacySweepstakes = { mode: PredictionMode.SWEEPSTAKES, jurisdiction_code: "US" }

  it.each([
    [PredictionMarketState.DRAFT, PredictionMarketState.SCHEDULED],
    [PredictionMarketState.SCHEDULED, PredictionMarketState.OPEN],
  ])(
    "refuses %s -> %s for a market the policy in force no longer admits, with a coded FORBIDDEN",
    async (from, to) => {
      const ctx = transitionCtx(from, legacySweepstakes)

      const err = await transition(ctx, "m_1", to).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(MedusaError)
      expect((err as MedusaError).type).toBe(MedusaError.Types.FORBIDDEN)
      expect((err as MedusaError).code).toBe(PREDICTION_MODE_NOT_PERMITTED)
      expect((err as MedusaError).message).toBe(
        "sweepstakes markets are not permitted for US (profile US-RESTRICTED)"
      )
      expect(ctx.updatePredictionMarkets).not.toHaveBeenCalled()
    }
  )

  it.each([PredictionMarketState.DRAFT, PredictionMarketState.SCHEDULED, PredictionMarketState.OPEN])(
    "still lets an operator void such a market from %s",
    async (from) => {
      const ctx = transitionCtx(from, legacySweepstakes)

      await transition(ctx, "m_1", PredictionMarketState.VOIDED)

      expect(ctx.updatePredictionMarkets).toHaveBeenCalledWith({ id: "m_1", state: PredictionMarketState.VOIDED })
    }
  )

  it("refuses an illegal transition on the state machine before it consults the policy", async () => {
    const ctx = transitionCtx(PredictionMarketState.DRAFT, legacySweepstakes)

    const err = await transition(ctx, "m_1", PredictionMarketState.OPEN).catch((e: unknown) => e)

    expect((err as MedusaError).type).toBe(MedusaError.Types.NOT_ALLOWED)
  })

  it("refuses a position on an open market the policy no longer admits, before the age gate writes anything", async () => {
    const ctx: any = {
      policyService: new PredictionPolicyService(),
      listPredictionMarkets: jest
        .fn()
        .mockResolvedValue([{ id: "m_1", state: PredictionMarketState.OPEN, ...legacySweepstakes }]),
      listPredictionPositions: jest.fn().mockResolvedValue([]),
      ensureSupporterEligibility: jest.fn().mockResolvedValue({}),
      // An age-verified supporter, so only the policy can refuse.
      isSupporterAgeVerified: jest.fn().mockResolvedValue(true),
      createPredictionPositions: jest.fn(),
      markSupporterParticipation: jest.fn(),
    }

    const err = await VendorHypeOperationsPredictionService.prototype.placePredictionPosition
      .call(ctx, {
        market_id: "m_1",
        supporter_id: "sup_1",
        outcome_option_key: "YES",
        stake_amount: 1,
        idempotency_key: "idem_1",
      })
      .catch((e: unknown) => e)

    expect((err as MedusaError).type).toBe(MedusaError.Types.FORBIDDEN)
    expect((err as MedusaError).code).toBe(PREDICTION_MODE_NOT_PERMITTED)
    expect(ctx.isSupporterAgeVerified).not.toHaveBeenCalled()
    expect(ctx.ensureSupporterEligibility).not.toHaveBeenCalled()
    expect(ctx.createPredictionPositions).not.toHaveBeenCalled()
  })

  describe("createPredictionMarket", () => {
    const createInput = {
      profile_id: "hp_1",
      title: "Ships 500 boxes by June",
      jurisdiction_code: "ROW",
      oracle_config_id: "oracle_1",
      starts_at: new Date("2026-12-01T00:00:00.000Z"),
      locks_at: new Date("2026-12-10T00:00:00.000Z"),
      created_by: "cus_owner",
    }
    const createCtx = () => {
      const policyService = new PredictionPolicyService()
      return {
        policyService,
        createPredictionMarkets: jest.fn(async (rows: Array<Record<string, unknown>>) =>
          rows.map((row) => ({ id: "pm_1", ...row }))
        ),
      }
    }
    const create = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
      VendorHypeOperationsPredictionService.prototype.createPredictionMarket.call(
        ctx as never,
        // A JS caller, or a route that forwards its body, can still send keys
        // the input type no longer declares.
        input as never
      )

    it("stores the deciding policy's version even when the caller passes one", async () => {
      const ctx = createCtx()

      await create(ctx, { ...createInput, policy_version: "attacker_v9" })

      const [[rows]] = ctx.createPredictionMarkets.mock.calls
      const decision = ctx.policyService.evaluateMode(PredictionMode.NON_CASH, "ROW")
      expect(rows[0].policy_version).toBe(decision.policy_version)
      expect(rows[0].policy_version).not.toBe("attacker_v9")
    })

    it("stores the decision with the market, over any policy_decision the caller put in metadata", async () => {
      const ctx = createCtx()

      await create(ctx, {
        ...createInput,
        metadata: { campaign: "spring", policy_decision: { profile: "US-REGULATED-CASH", matched: "US-NV" } },
      })

      const [[rows]] = ctx.createPredictionMarkets.mock.calls
      expect(rows[0].metadata).toEqual({
        campaign: "spring",
        policy_decision: {
          policy_version: ctx.policyService.policyVersion,
          mode: PredictionMode.NON_CASH,
          jurisdiction_code: "ROW",
          matched: null,
          profile: "ROW-NONCASH",
          allowed_modes: [PredictionMode.NON_CASH],
        },
      })
      expect(rows[0].state).toBe(PredictionMarketState.DRAFT)
    })

    it.each([
      [PredictionMode.SWEEPSTAKES, "US-CA"],
      [PredictionMode.REGULATED_CASH, "US"],
      [PredictionMode.SWEEPSTAKES, "ZZ"],
    ])("refuses %s in %s with a coded FORBIDDEN (it was a plain Error, a 500), writing nothing", async (mode, code) => {
      const ctx = createCtx()

      const err = await create(ctx, { ...createInput, mode, jurisdiction_code: code }).catch((e: unknown) => e)

      expect(MedusaError.isMedusaError(err as MedusaError)).toBe(true)
      expect((err as MedusaError).type).toBe(MedusaError.Types.FORBIDDEN)
      expect((err as MedusaError).code).toBe(PREDICTION_MODE_NOT_PERMITTED)
      expect((err as MedusaError).message).toMatch(new RegExp(`^${mode} markets are not permitted for `))
      expect(ctx.createPredictionMarkets).not.toHaveBeenCalled()
    })
  })

  it("returns existing position for same idempotency key", async () => {
    const existingPosition = { id: "pos_1" }
    const ctx: any = {
      policyService: new PredictionPolicyService(),
      listPredictionMarkets: jest.fn().mockResolvedValue([
        { id: "m_1", state: PredictionMarketState.OPEN, mode: PredictionMode.NON_CASH, jurisdiction_code: "US" },
      ]),
      listPredictionPositions: jest.fn().mockResolvedValueOnce([existingPosition]).mockResolvedValueOnce([]),
      ensureSupporterEligibility: jest.fn().mockResolvedValue({}),
      // An entitled supporter: stands in for the server-side age record that
      // does not exist yet (see isSupporterAgeVerified).
      isSupporterAgeVerified: jest.fn().mockResolvedValue(true),
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

  it.each(Object.values(PredictionMode))(
    "holds no server-side age verification for anyone in %s mode, so the age gate fails closed",
    async (mode) => {
      await expect(
        VendorHypeOperationsPredictionService.prototype.isSupporterAgeVerified.call({}, "sup_1", mode)
      ).resolves.toBe(false)
    }
  )

  it("refuses to place a position without a server-side age verification", async () => {
    const ctx: any = {
      policyService: new PredictionPolicyService(),
      listPredictionMarkets: jest.fn().mockResolvedValue([
        { id: "m_1", state: PredictionMarketState.OPEN, mode: PredictionMode.NON_CASH, jurisdiction_code: "US" },
      ]),
      listPredictionPositions: jest.fn().mockResolvedValue([]),
      ensureSupporterEligibility: jest.fn().mockResolvedValue({}),
      isSupporterAgeVerified: VendorHypeOperationsPredictionService.prototype.isSupporterAgeVerified,
      createPredictionPositions: jest.fn(),
      markSupporterParticipation: jest.fn(),
    }

    await expect(
      VendorHypeOperationsPredictionService.prototype.placePredictionPosition.call(ctx, {
        market_id: "m_1",
        supporter_id: "sup_1",
        outcome_option_key: "YES",
        stake_amount: 1,
        idempotency_key: "idem_1",
      })
    ).rejects.toThrow("age_verification_required")
    expect(ctx.createPredictionPositions).not.toHaveBeenCalled()
    expect(ctx.markSupporterParticipation).not.toHaveBeenCalled()
    // ensureSupporterEligibility inserts a user_prediction_safety row for a
    // first-time supporter, so it must not run for a call the gate refuses.
    expect(ctx.ensureSupporterEligibility).not.toHaveBeenCalled()
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
