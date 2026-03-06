import handler from "../prediction-settlement-finalized"

describe("prediction settlement finalized subscriber", () => {
  it("emits payout processing failed if settlement is missing", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      listPredictionSettlements: jest.fn().mockResolvedValue([]),
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
        },
      },
      container,
    } as any)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "prediction.payout.processing_failed",
        data: expect.objectContaining({ reason: "settlement_not_found" }),
      })
    )
  })

  it("processes computed payouts and emits processed event", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      listPredictionSettlements: jest.fn().mockResolvedValue([{ id: "set_1", settlement_ref: "set_1" }]),
      processComputedPayoutsForSettlement: jest
        .fn()
        .mockResolvedValue({ settlement_id: "set_1", credited: 1, failed: 1, skipped: 0 }),
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
          audit: {
            execution_run_id: "run_1",
            settled_by: "admin_1",
          },
        },
      },
      container,
    } as any)

    expect(service.processComputedPayoutsForSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_id: "set_1", execution_run_id: "run_1", processed_by: "admin_1" })
    )
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.processed" }))
  })
})
