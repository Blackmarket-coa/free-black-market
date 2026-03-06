import VendorHypeOperationsPredictionService from "../service"
import { PredictionMarketState, PredictionMode } from "../models"

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
      listPredictionPositions: jest
        .fn()
        .mockResolvedValueOnce([existingPosition])
        .mockResolvedValueOnce([]),
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

})
