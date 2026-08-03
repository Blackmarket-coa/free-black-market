import { processPlanRenewals } from "../vendor-plan-renewals"
import VendorBillingService from "../../modules/vendor-billing/service"
import { VENDOR_BILLING_MODULE } from "../../modules/vendor-billing"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"

const NOW = new Date("2026-09-01T01:00:00Z")
const PERIOD_END = new Date("2026-09-01T00:00:00Z")

type Row = Record<string, unknown> & { id: string }

const makeWorld = (opts: {
  assignments?: Row[]
  pendingChanges?: Row[]
  rollThrows?: boolean
} = {}) => {
  const charges: Row[] = []
  const billing = Object.create(
    VendorBillingService.prototype
  ) as Record<string, unknown>
  billing.listVendorCharges = (async (where: Record<string, unknown> = {}) =>
    charges.filter((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    )) as never
  billing.createVendorCharges = (async (data: Record<string, unknown>) => {
    const row = { ...data, id: `vc_${charges.length + 1}` } as Row
    charges.push(row)
    return row
  }) as never
  billing.updateVendorCharges = (async (data: Record<string, unknown>) => {
    const row = charges.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  const applyPendingChange = jest.fn(async (sellerId: string) => ({
    seller_id: sellerId,
  }))
  const rollPeriod = jest.fn(async () => {
    if (opts.rollThrows) throw new Error("roll failed")
    return {}
  })

  const plans = {
    listDuePendingChanges: jest.fn(async () => opts.pendingChanges ?? []),
    listVendorPlanAssignments: jest.fn(async () => opts.assignments ?? []),
    applyPendingChange,
    rollPeriod,
    ensureAssignment: jest.fn(async () => ({
      plan_code: "pro",
      stripe_customer_id: null,
    })),
  }

  const container = {
    resolve: (key: string) => {
      if (key === VENDOR_BILLING_MODULE) return billing
      if (key === VENDOR_PLAN_MODULE) return plans
      return undefined
    },
  }

  return { container, charges, plans, applyPendingChange, rollPeriod }
}

const dueAssignment = (over: Partial<Row> = {}): Row => ({
  id: "vpa_1",
  seller_id: "sel_1",
  plan_code: "pro",
  status: "active",
  current_period_end: PERIOD_END,
  ...over,
})

beforeEach(() => clearPlanFeatureCache())

describe("processPlanRenewals", () => {
  it("applies due pending downgrades first", async () => {
    const { container, applyPendingChange } = makeWorld({
      pendingChanges: [
        { id: "vpa_1", seller_id: "sel_1", pending_plan_code: "starter" },
      ],
    })

    const outcomes = await processPlanRenewals(container as never, NOW)

    expect(applyPendingChange).toHaveBeenCalledWith("sel_1", NOW)
    expect(outcomes).toContainEqual({
      seller_id: "sel_1",
      action: "pending_applied",
    })
  })

  it("raises next period's charge and rolls the period", async () => {
    const { container, charges, rollPeriod } = makeWorld({
      assignments: [dueAssignment()],
    })

    const outcomes = await processPlanRenewals(container as never, NOW)

    // Rolled from the period that ENDED, not from `now` — a late cron must
    // not shorten the next period.
    const expectedEnd = new Date(PERIOD_END)
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1)

    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({
      seller_id: "sel_1",
      kind: "plan",
      amount: 9900,
      idempotency_key: `plan:sel_1:pro:${expectedEnd.toISOString()}`,
    })
    expect(rollPeriod).toHaveBeenCalledWith("sel_1", NOW)
    expect(outcomes[0].action).toBe("renewed")
    // Billing unconfigured in tests: recorded, not collected.
    expect(outcomes[0].charge_status).toBe("pending")
  })

  it("replays the charge instead of double-billing when re-run", async () => {
    const world = makeWorld({ assignments: [dueAssignment()] })
    await processPlanRenewals(world.container as never, NOW)

    // Simulate the roll not having taken (crash between charge and roll):
    // the assignment is still listed as due, so the run repeats — and the
    // charge-first ordering makes the second attempt collide on the key.
    await processPlanRenewals(world.container as never, NOW)

    expect(world.charges).toHaveLength(1)
  })

  it("skips free and operator plans with stale period ends", async () => {
    const { container, charges, rollPeriod } = makeWorld({
      assignments: [
        dueAssignment({ plan_code: "free", seller_id: "sel_free" }),
        dueAssignment({ plan_code: "internal", seller_id: "sel_internal" }),
      ],
    })

    const outcomes = await processPlanRenewals(container as never, NOW)

    expect(charges).toHaveLength(0)
    expect(rollPeriod).not.toHaveBeenCalled()
    expect(outcomes).toHaveLength(0)
  })

  it("skips canceled and past_due assignments", async () => {
    const { container, charges } = makeWorld({
      assignments: [
        dueAssignment({ status: "canceled", seller_id: "sel_c" }),
        dueAssignment({ status: "past_due", seller_id: "sel_p" }),
      ],
    })

    await processPlanRenewals(container as never, NOW)
    expect(charges).toHaveLength(0)
  })

  it("keeps processing when one seller fails", async () => {
    const { container, charges, rollPeriod } = makeWorld({
      assignments: [
        dueAssignment({ seller_id: "sel_boom" }),
        dueAssignment({ id: "vpa_2", seller_id: "sel_ok", plan_code: "starter" }),
      ],
      rollThrows: true,
    })
    // First seller's roll throws; the loop must reach the second. (Both throw
    // here, which still proves isolation: two failed outcomes, no abort.)
    rollPeriod.mockImplementationOnce(async () => {
      throw new Error("roll failed")
    })

    const outcomes = await processPlanRenewals(container as never, NOW)

    expect(outcomes.filter((o) => o.action === "failed").length).toBeGreaterThan(0)
    expect(outcomes).toHaveLength(2)
    // Charge-first: both sellers' charges were recorded even where the roll
    // failed — money owed is never lost to a crash.
    expect(charges).toHaveLength(2)
  })
})
