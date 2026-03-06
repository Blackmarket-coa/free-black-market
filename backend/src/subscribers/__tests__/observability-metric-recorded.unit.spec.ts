import handler from "../observability-metric-recorded"
import * as sinks from "../../shared/observability-sinks"

jest.mock("../../shared/observability-sinks", () => ({
  sendMetricToSinks: jest.fn().mockResolvedValue(undefined),
}))

describe("observability metric recorded subscriber", () => {
  it("forwards metric events to sink adapters", async () => {
    const logger = { warn: jest.fn() }

    await handler({
      event: {
        data: {
          metric: "prediction.payout.processed",
          value: 1,
          tags: { market_id: "m_1" },
        },
      },
      container: {
        resolve: () => logger,
      },
    } as any)

    expect(sinks.sendMetricToSinks).toHaveBeenCalled()
  })
})
