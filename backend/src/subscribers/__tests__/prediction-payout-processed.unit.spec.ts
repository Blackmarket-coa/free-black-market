import handler from "../prediction-payout-processed"

describe("prediction payout processed subscriber", () => {
  it("logs and emits observability metric", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const logger = { info: jest.fn() }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          settlement_id: "set_1",
          summary: { credited: 1, failed: 1, skipped: 0 },
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          return logger
        },
      },
    } as any)

    expect(logger.info).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "observability.metric.recorded" }))
  })
})
