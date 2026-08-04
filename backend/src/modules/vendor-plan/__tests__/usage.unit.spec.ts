import {
  APPROACHING_RATIO,
  COUNTABLE_LIMIT_KEYS,
  METERED_LIMIT_KEYS,
  METERED_METRIC_LABELS,
  buildUsageReport,
  meteredUsage,
  resourceUsage,
  type MeterReading,
} from "../usage"
import { limitsForPlan } from "../limits"
import {
  EMBED_REQUEST_BLOCK,
  EMBED_REQUEST_BLOCK_CENTS,
  USAGE_METRICS,
  computeOverage,
} from "../overage"

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

describe("meteredUsage", () => {
  const reading = (recorded: number): MeterReading => ({
    metric: "embed_requests",
    recorded,
    period_start: "2026-08-01T00:00:00.000Z",
    period_end: "2026-09-01T00:00:00.000Z",
  })

  it("projects nothing while inside the included volume", () => {
    const usage = meteredUsage(reading(400_000), 1_000_000)
    expect(usage).toMatchObject({
      recorded: 400_000,
      included: 1_000_000,
      excess: 0,
      blocks: 0,
      projected_amount_cents: 0,
      level: "ok",
      percent_used: 40,
    })
  })

  it("warns before the vendor starts paying, not after", () => {
    // The whole reason this row exists: the first signal must not be an
    // invoice. 80% of the allowance, same threshold as the capped resources.
    expect(meteredUsage(reading(800_000), 1_000_000).level).toBe("approaching")
    expect(meteredUsage(reading(799_999), 1_000_000).level).toBe("ok")
    expect(APPROACHING_RATIO).toBe(0.8)
  })

  it("prices overage with the same function the close job bills with", () => {
    // Load-bearing: the projection a vendor reads has to come from the code
    // that charges them, or the two drift and the number stops being credible.
    const usage = meteredUsage(reading(1_240_000), 1_000_000)
    const billed = computeOverage({
      recorded: 1_240_000,
      included: 1_000_000,
    })
    expect(usage.projected_amount_cents).toBe(billed.amount_cents)
    expect(usage.excess).toBe(billed.excess)
    expect(usage.blocks).toBe(billed.blocks)
    expect(usage.level).toBe("over")
  })

  it("reports past-allowance consumption above 100%, not clamped", () => {
    // The opposite rule from a capped resource. Over a cap, >100% would be a
    // bug; over a meter it is the figure that makes the projected charge
    // legible, so it must survive to the response.
    const usage = meteredUsage(reading(1_500_000), 1_000_000)
    expect(usage.percent_used).toBe(150)
  })

  it("never bills an unlimited allowance", () => {
    const usage = meteredUsage(reading(9_000_000), null)
    expect(usage).toMatchObject({
      unlimited: true,
      percent_used: null,
      level: "ok",
      excess: 0,
      projected_amount_cents: 0,
    })
  })

  it("bills a zero allowance without inventing a percentage", () => {
    // Every request is billable, but "x% of 0" is not a number — reporting one
    // would be a fabricated figure rather than a large one.
    const usage = meteredUsage(reading(1_000), 0)
    expect(usage.percent_used).toBeNull()
    expect(usage.level).toBe("over")
    expect(usage.projected_amount_cents).toBe(EMBED_REQUEST_BLOCK_CENTS)
  })

  it("surfaces the pricing in force so the projection can be explained", () => {
    const usage = meteredUsage(reading(0), 1_000)
    expect(usage.block_size).toBe(EMBED_REQUEST_BLOCK)
    expect(usage.cents_per_block).toBe(EMBED_REQUEST_BLOCK_CENTS)
    expect(usage.label).toBe(METERED_METRIC_LABELS.embed_requests)
  })

  it("carries the open period through untouched", () => {
    const usage = meteredUsage(reading(10), 1_000)
    expect(usage.period_start).toBe("2026-08-01T00:00:00.000Z")
    expect(usage.period_end).toBe("2026-09-01T00:00:00.000Z")
  })
})

describe("metered section of the report", () => {
  const meter = (recorded: number): MeterReading => ({
    metric: "embed_requests",
    recorded,
    period_start: "2026-08-01T00:00:00.000Z",
    period_end: "2026-09-01T00:00:00.000Z",
  })

  it("resolves each metric against the allowance that actually bills it", () => {
    // Drift guard: if a metric ever pointed at the wrong limit key, the panel
    // would show a projection computed against a number nobody is billed on.
    for (const metric of USAGE_METRICS) {
      expect(METERED_LIMIT_KEYS[metric]).toBeDefined()
      expect(METERED_METRIC_LABELS[metric]).toBeTruthy()
    }
    expect(METERED_LIMIT_KEYS.embed_requests).toBe("included_embed_requests")
  })

  it("totals the projection across meters", () => {
    const pro = limitsForPlan("pro")
    const report = buildUsageReport("pro", pro, {}, [meter(1_240_000)])
    expect(report.metered).toHaveLength(1)
    expect(report.projected_overage_cents).toBe(
      report.metered[0].projected_amount_cents
    )
    expect(report.projected_overage_cents).toBeGreaterThan(0)
  })

  it("reports no projection when no meter could be read", () => {
    // Same rule as a failed count: absence is honest, and here it also means
    // the page must not claim a settled $0.00.
    const report = buildUsageReport("pro", limitsForPlan("pro"), {})
    expect(report.metered).toEqual([])
    expect(report.projected_overage_cents).toBe(0)
  })

  it("charges nothing on the unlimited plan however much is recorded", () => {
    const report = buildUsageReport("internal", limitsForPlan("internal"), {}, [
      meter(50_000_000),
    ])
    expect(report.metered[0].unlimited).toBe(true)
    expect(report.projected_overage_cents).toBe(0)
  })
})
