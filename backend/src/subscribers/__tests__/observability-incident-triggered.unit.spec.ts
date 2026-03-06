import handler from "../observability-incident-triggered"
import * as sinks from "../../shared/observability-sinks"

jest.mock("../../shared/observability-sinks", () => ({
  sendIncidentToSinks: jest.fn().mockResolvedValue(undefined),
}))

describe("observability incident triggered subscriber", () => {
  it("forwards incident events to sink adapters", async () => {
    const logger = { warn: jest.fn() }

    await handler({
      event: {
        data: {
          provider: "pagerduty",
          severity: "high",
          service: "vendor-hype-prediction",
          incident_key: "inc_1",
          details: { reason: "dead_letter" },
        },
      },
      container: {
        resolve: () => logger,
      },
    } as any)

    expect(sinks.sendIncidentToSinks).toHaveBeenCalled()
  })
})
