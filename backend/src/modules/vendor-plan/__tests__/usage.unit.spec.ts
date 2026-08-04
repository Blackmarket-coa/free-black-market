import {
  APPROACHING_RATIO,
  COUNTABLE_LIMIT_KEYS,
  buildUsageReport,
  resourceUsage,
} from "../usage"
import { limitsForPlan } from "../limits"

describe("resourceUsage", () => {
  it("reports headroom below the warning threshold", () => {
    const usage = resourceUsage(2, 10)
    expect(usage).toMatchObject({
      current: 2,
      limit: 10,
      remaining: 8,
      percent_used: 20,
      level: "ok",
      unlimited: false,
    })
  })

  it("warns once the approaching ratio is crossed", () => {
    // 8 of 10 is exactly the threshold — warn at it, not only past it, or the
    // warning never fires on small allowances.
    expect(resourceUsage(8, 10).level).toBe("approaching")
    expect(resourceUsage(7, 10).level).toBe("ok")
    expect(APPROACHING_RATIO).toBe(0.8)
  })

  it("reports at_limit exactly when the ceiling is reached", () => {
    const usage = resourceUsage(10, 10)
    expect(usage.level).toBe("at_limit")
    expect(usage.remaining).toBe(0)
    expect(usage.percent_used).toBe(100)
  })

  it("handles a seller left over the limit by a downgrade", () => {
    // A downgrade lowers the ceiling under a seller who already holds more.
    // Nothing is confiscated, so this must not show negative headroom or
    // claim more than 100% used.
    const usage = resourceUsage(12, 10)
    expect(usage.level).toBe("at_limit")
    expect(usage.remaining).toBe(0)
    expect(usage.percent_used).toBe(100)
  })

  it("treats a zero limit as a real cap, not a missing one", () => {
    const usage = resourceUsage(0, 0)
    expect(usage.level).toBe("at_limit")
    expect(usage.remaining).toBe(0)
    // 100 rather than NaN — the divide by zero must not reach the response.
    expect(usage.percent_used).toBe(100)
  })

  it("reports unlimited without inventing a percentage", () => {
    const usage = resourceUsage(9_999, null)
    expect(usage).toMatchObject({
      unlimited: true,
      remaining: null,
      percent_used: null,
      level: "ok",
    })
  })

  it("clamps nonsense counts rather than propagating them", () => {
    expect(resourceUsage(-5, 10).current).toBe(0)
    expect(resourceUsage(2.7, 10).current).toBe(2)
    expect(resourceUsage(NaN, 10).current).toBe(0)
  })
})

describe("buildUsageReport", () => {
  const limits = limitsForPlan("free")

  it("reports every countable resource with its label", () => {
    const report = buildUsageReport("free", limits, {
      embed_keys: 0,
      connect_domains: 0,
      webhook_subscriptions: 0,
      vault_documents: 0,
    })
    expect(report.plan_code).toBe("free")
    expect(report.resources.map((r) => r.key).sort()).toEqual(
      [...COUNTABLE_LIMIT_KEYS].sort()
    )
    expect(
      report.resources.find((r) => r.key === "embed_keys")?.label
    ).toBe("Embed keys")
  })

  it("omits a resource whose count could not be determined", () => {
    // The load-bearing case: a failed count must not render as "0 used", which
    // would tell a vendor they have headroom they may not have.
    const report = buildUsageReport("free", limits, {
      embed_keys: 1,
      connect_domains: 1,
    })
    expect(report.resources.map((r) => r.key).sort()).toEqual([
      "connect_domains",
      "embed_keys",
    ])
    expect(report.resources.some((r) => r.key === "vault_documents")).toBe(false)
  })

  it("flags when any resource is at its ceiling", () => {
    // Free allows 1 embed key.
    const atLimit = buildUsageReport("free", limits, { embed_keys: 1 })
    expect(atLimit.any_at_limit).toBe(true)

    const under = buildUsageReport("free", limits, { embed_keys: 0 })
    expect(under.any_at_limit).toBe(false)
  })

  it("reports rate and window allowances without pretending they are meters", () => {
    const report = buildUsageReport("free", limits, {})
    const keys = report.allowances.map((a) => a.key)
    expect(keys).toContain("embed_requests_per_minute")
    expect(keys).toContain("analytics_range_days")
    // They carry a limit only — no current, no remaining, nothing consumable.
    for (const allowance of report.allowances) {
      expect(typeof allowance.limit).toBe("number")
      expect(allowance).not.toHaveProperty("current")
    }
  })

  it("never reports a countable resource as at_limit on the unlimited plan", () => {
    const internal = limitsForPlan("internal")
    const report = buildUsageReport("internal", internal, {
      embed_keys: 500,
      connect_domains: 500,
      webhook_subscriptions: 500,
      vault_documents: 5_000,
    })
    expect(report.any_at_limit).toBe(false)
    expect(report.resources.every((r) => r.unlimited)).toBe(true)
  })
})
