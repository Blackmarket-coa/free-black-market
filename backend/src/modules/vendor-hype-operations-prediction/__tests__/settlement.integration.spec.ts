import VendorHypeOperationsPredictionService from "../service"
import { PredictionMarketState } from "../models"

describe("VendorHypeOperationsPredictionService settlement integration-style", () => {
  it("creates payout entries and updates market/positions on settlement", async () => {
    const createPredictionPayoutEntries = jest.fn().mockResolvedValue([])
    const updatePredictionPositions = jest.fn().mockResolvedValue(undefined)
    const updatePredictionMarkets = jest.fn().mockResolvedValue(undefined)

    const ctx: any = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", state: PredictionMarketState.IN_REVIEW }]),
      listPredictionSettlements: jest.fn().mockResolvedValue([]),
      createPredictionSettlements: jest.fn().mockResolvedValue([{ id: "set_1" }]),
      listPredictionPositions: jest.fn().mockResolvedValue([
        {
          id: "pos_1",
          supporter_id: "sup_1",
          outcome_option_key: "YES",
          stake_amount: 10,
          stake_unit: "points",
        },
        {
          id: "pos_2",
          supporter_id: "sup_2",
          outcome_option_key: "NO",
          stake_amount: 12,
          stake_unit: "points",
        },
      ]),
      createPredictionPayoutEntries,
      updatePredictionPositions,
      updatePredictionMarkets,
    }

    await VendorHypeOperationsPredictionService.prototype.settlePredictionMarket.call(ctx, {
      market_id: "m_1",
      settlement_ref: "set_ref_1",
      oracle_outcome_key: "YES",
      oracle_evidence_uri: "https://oracle/evidence",
      execution_run_id: "run_1",
      dispute_window_ends_at: new Date(Date.now() - 1000),
    })

    expect(createPredictionPayoutEntries).toHaveBeenCalled()
    expect(updatePredictionPositions).toHaveBeenCalledTimes(2)
    expect(updatePredictionMarkets).toHaveBeenCalledWith({ id: "m_1", state: "settled" })
  })
})
