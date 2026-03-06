import handler from "../prediction-payout-retry-execute"

describe("prediction payout retry execute subscriber", () => {
  it("processes payout and emits retry success", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      processComputedPayoutsForSettlement: jest
        .fn()
        .mockResolvedValue({ settlement_id: "set_1", credited: 1, failed: 0, skipped: 0 }),
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          settlement_id: "set_1",
          retry_attempt: 1,
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          return service
        },
      },
    } as any)

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.processed" }))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.retry_succeeded" }))
  })

  it("re-emits failure event if retry execution fails", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = {
      processComputedPayoutsForSettlement: jest.fn().mockRejectedValue(new Error("db_unavailable")),
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          settlement_id: "set_1",
          retry_attempt: 1,
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          return service
        },
      },
    } as any)

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.processing_failed" }))
  })
})
