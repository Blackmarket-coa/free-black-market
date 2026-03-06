import handler from "../prediction-payout-processing-failed"

describe("prediction payout processing failed subscriber", () => {
  it("schedules payout retry with backoff", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const logger = { error: jest.fn(), warn: jest.fn() }
    const service = {
      listPredictionSettlements: jest.fn().mockResolvedValue([{ id: "set_1" }]),
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          reason: "temporary_db_failure",
          retry_attempt: 0,
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          if (token === "logger") return logger
          return service
        },
      },
    } as any)

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.retry_scheduled" }))
  })

  it("dead-letters and triggers incident when retries are exhausted", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const logger = { error: jest.fn(), warn: jest.fn() }
    const service = {
      listPredictionSettlements: jest.fn().mockResolvedValue([{ id: "set_1" }]),
    }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          settlement_id: "set_1",
          reason: "persistent_failure",
          retry_attempt: 2,
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          if (token === "logger") return logger
          return service
        },
      },
    } as any)

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.dead_lettered" }))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "observability.incident.triggered" }))
  })
})
