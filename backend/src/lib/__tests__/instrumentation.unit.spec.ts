import {
  emitMetric,
  resetMetricsForTesting,
  snapshotMetrics,
} from "../instrumentation"

describe("instrumentation", () => {
  beforeEach(() => {
    resetMetricsForTesting()
  })

  it("counts emissions of the same (name, labels) pair", () => {
    const stderr = jest.spyOn(console, "warn").mockImplementation(() => {})
    emitMetric("vendor.verification.submitted", { check_type: "IDENTITY" })
    emitMetric("vendor.verification.submitted", { check_type: "IDENTITY" })
    emitMetric("vendor.verification.submitted", { check_type: "LOCATION" })

    const snap = snapshotMetrics()
    const identity = snap.find(
      (m) =>
        m.name === "vendor.verification.submitted" &&
        m.labels.check_type === "IDENTITY"
    )
    const location = snap.find(
      (m) =>
        m.name === "vendor.verification.submitted" &&
        m.labels.check_type === "LOCATION"
    )
    expect(identity?.value).toBe(2)
    expect(location?.value).toBe(1)
    expect(stderr).toHaveBeenCalledTimes(3)
    stderr.mockRestore()
  })

  it("treats label key order as irrelevant", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    emitMetric("m", { a: 1, b: 2 })
    emitMetric("m", { b: 2, a: 1 })
    const snap = snapshotMetrics()
    expect(snap.filter((s) => s.name === "m")).toHaveLength(1)
    expect(snap.find((s) => s.name === "m")?.value).toBe(2)
  })

  it("supports custom non-1 increments", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    emitMetric("vendor.verification.trust_score", { level: "AUDITED" }, 75)
    const snap = snapshotMetrics()
    expect(snap.find((s) => s.name === "vendor.verification.trust_score")?.value).toBe(75)
  })
})
