import { processUsageBilling } from "../vendor-usage-billing"
import { VENDOR_USAGE_MODULE } from "../../modules/vendor-usage"
import { VENDOR_BILLING_MODULE } from "../../modules/vendor-billing"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"
import { EMBED_REQUEST_BLOCK_CENTS } from "../../modules/vendor-plan/overage"

jest.mock("../../shared/vendor-charge-execution", () => ({
  executeCharge: jest.fn(async () => ({ executed: false, reason: "no_payment_method" })),
  isVendorBillingConfigured: () => false,
}))

/**
 * The close job's contract: bill overage once per seller per period, never
 * charge a seller inside their allowance, and survive a re-run without
 * double-billing.
 */
type UsageRow = {
  id: string
  seller_id: string
  metric: string
  period_start: Date
  period_end: Date
  quantity: number
  billed_at: Date | null
  charge_id: string | null
}

const PERIOD_START = new Date("2026-07-01T00:00:00.000Z")
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z")
// Runs on the 2nd, billing July.
const NOW = new Date("2026-08-02T02:00:00.000Z")

const makeContainer = (
  opts: { rows?: Partial<UsageRow>[]; planCode?: string; chargeThrows?: string[] } = {}
) => {
  const rows: UsageRow[] = (opts.rows ?? []).map((r, i) => ({
    id: r.id ?? `vur_${i + 1}`,
    seller_id: r.seller_id ?? `sel_${i + 1}`,
    metric: "embed_requests",
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    quantity: r.quantity ?? 0,
    billed_at: r.billed_at ?? null,
    charge_id: r.charge_id ?? null,
  }))

  const charges: Record<string, unknown>[] = []

  const usage = {
    listUnbilledForPeriod: jest.fn(async () =>
      rows.filter((r) => r.billed_at === null)
    ),
    markBilled: jest.fn(async (id: string, charge_id: string | null) => {
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.billed_at = new Date()
        row.charge_id = charge_id
      }
    }),
  }

  const billing = {
    createCharge: jest.fn(async (input: Record<string, unknown>) => {
      if (opts.chargeThrows?.includes(input.seller_id as string)) {
        throw new Error("charge write failed")
      }
      const existing = charges.find(
        (c) =>
          c.seller_id === input.seller_id && c.discriminator === input.discriminator
      )
      if (existing) return { charge: existing, replayed: true }
      const charge = { ...input, id: `vc_${charges.length + 1}` }
      charges.push(charge)
      return { charge, replayed: false }
    }),
  }

  const container = {
    resolve: (key: string) => {
      if (key === VENDOR_USAGE_MODULE) return usage
      if (key === VENDOR_BILLING_MODULE) return billing
      if (key === VENDOR_PLAN_MODULE) {
        return {
          ensureAssignment: async () => ({ plan_code: opts.planCode ?? "free" }),
          getEntitledFeatureKeys: async () => [],
        }
      }
      if (key === ENTITLEMENT_MODULE) {
        return { listActiveFeatureKeysForSeller: async () => [] }
      }
      return undefined
    },
  }

  return { container: container as never, rows, charges, usage, billing }
}

afterEach(() => clearPlanFeatureCache())

describe("processUsageBilling", () => {
  it("charges a seller over their included volume", async () => {
    // Free includes 50,000; 52,000 recorded → 2,000 over → 2 blocks.
    const world = makeContainer({ rows: [{ seller_id: "sel_1", quantity: 52_000 }] })
    const result = await processUsageBilling(world.container, NOW)

    expect(result.charged).toBe(1)
    expect(world.charges).toHaveLength(1)
    expect(world.charges[0]).toMatchObject({
      seller_id: "sel_1",
      kind: "usage",
      amount: EMBED_REQUEST_BLOCK_CENTS * 2,
      discriminator: "embed_requests:2026-07",
    })
  })

  it("raises no charge for a seller inside their allowance", async () => {
    // A zero-amount charge row would be noise implying we tried to collect.
    const world = makeContainer({ rows: [{ seller_id: "sel_1", quantity: 10 }] })
    const result = await processUsageBilling(world.container, NOW)

    expect(result.within_allowance).toBe(1)
    expect(result.charged).toBe(0)
    expect(world.charges).toHaveLength(0)
    // Still stamped, so the next run does not re-examine it.
    expect(world.rows[0].billed_at).not.toBeNull()
  })

  it("does not double-bill when the job re-runs", async () => {
    const world = makeContainer({ rows: [{ seller_id: "sel_1", quantity: 52_000 }] })
    await processUsageBilling(world.container, NOW)
    const second = await processUsageBilling(world.container, NOW)

    // The first run stamped billed_at, so the second sees no work at all.
    expect(second.examined).toBe(0)
    expect(world.charges).toHaveLength(1)
  })

  it("keys the charge on the period, not the clock, so a late run still collides", async () => {
    const world = makeContainer({ rows: [{ seller_id: "sel_1", quantity: 52_000 }] })
    await processUsageBilling(world.container, NOW)
    // A re-fire days later bills the same period and must reuse the key.
    const discriminators = world.billing.createCharge.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).discriminator
    )
    expect(discriminators).toEqual(["embed_requests:2026-07"])
  })

  it("stamps billed only after the charge exists", async () => {
    // Ordering guard: a crash between the two must replay, not silently skip a
    // period. If the stamp came first, a failed charge would leave the period
    // marked billed and never collected.
    const world = makeContainer({
      rows: [{ seller_id: "sel_1", quantity: 52_000 }],
      chargeThrows: ["sel_1"],
    })
    const result = await processUsageBilling(world.container, NOW)

    expect(result.failed).toBe(1)
    expect(world.rows[0].billed_at).toBeNull()
    expect(world.usage.markBilled).not.toHaveBeenCalled()
  })

  it("keeps billing the rest of the batch when one seller fails", async () => {
    const world = makeContainer({
      rows: [
        { seller_id: "sel_1", quantity: 52_000 },
        { seller_id: "sel_2", quantity: 60_000 },
        { seller_id: "sel_3", quantity: 55_000 },
      ],
      chargeThrows: ["sel_2"],
    })
    const result = await processUsageBilling(world.container, NOW)

    expect(result.charged).toBe(2)
    expect(result.failed).toBe(1)
    expect(world.charges.map((c) => c.seller_id)).toEqual(["sel_1", "sel_3"])
  })

  it("never bills an operator-plan seller regardless of volume", async () => {
    const world = makeContainer({
      planCode: "internal",
      rows: [{ seller_id: "sel_1", quantity: 50_000_000 }],
    })
    const result = await processUsageBilling(world.container, NOW)

    expect(result.charged).toBe(0)
    expect(result.within_allowance).toBe(1)
    expect(world.charges).toHaveLength(0)
  })
})
