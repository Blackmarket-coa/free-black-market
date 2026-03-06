import handler from "../prediction-payout-retry-scheduled"

describe("prediction payout retry scheduled subscriber", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("publishes retry execute event after backoff", async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const logger = { info: jest.fn() }

    await handler({
      event: {
        data: {
          market_id: "m_1",
          settlement_ref: "set_1",
          settlement_id: "set_1",
          retry_attempt: 1,
          backoff_seconds: 2,
          next_retry_at: new Date(Date.now() + 2000).toISOString(),
          dead_letter_topic: "prediction.payout.retry.dlq.v1",
        },
      },
      container: {
        resolve: (token: string) => {
          if (token === "event_bus") return { emit }
          return logger
        },
      },
    } as any)

    expect(emit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(2000)
    await Promise.resolve()

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: "prediction.payout.retry.execute" }))
  })
})
