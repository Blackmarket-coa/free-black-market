import { GET as PREVIEW } from "../preview/route"
import { POST as CHANGE } from "../change/route"
import VendorPlanService from "../../../../modules/vendor-plan/service"
import VendorBillingService from "../../../../modules/vendor-billing/service"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import { VendorPlanStatus } from "../../../../modules/vendor-plan/models"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../../../shared/plan-entitlement-cache"

/**
 * GET /vendor/plan/preview — the per-seller terms the panel's confirm step
 * shows before a vendor approves a recurring charge. Real route handlers, the
 * real VendorPlanService and VendorBillingService over in-memory rows; modules
 * are keyed on their imported constants and anything else throws.
 *
 * The point of the route is that its terms are the terms the change route
 * then applies, so several cases preview and then really change, and compare.
 */

jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

const ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1
const SELLER = "sel_1"
const DAY = 86_400_000

type Row = Record<string, unknown> & { id: string }

const matches = (row: Row, filters: Record<string, unknown>) =>
  Object.entries(filters).every(([k, v]) => {
    if (v === undefined) return true
    if (v && typeof v === "object" && "$lte" in v) {
      const bound = (v as { $lte: Date }).$lte
      return row[k] != null && new Date(row[k] as Date).getTime() <= new Date(bound).getTime()
    }
    return row[k] === v
  })

function makeWorld() {
  const assignments: Row[] = []
  const events: Row[] = []
  const plans = Object.create(VendorPlanService.prototype) as Record<string, unknown>
  plans.listVendorPlanAssignments = async (f: Record<string, unknown> = {}) =>
    assignments.filter((r) => matches(r, f))
  plans.createVendorPlanAssignments = async (e: Row | Row[]) => {
    const out = (Array.isArray(e) ? e : [e]).map((x, i) => ({ ...x, id: `vpa_${assignments.length + i + 1}` }))
    assignments.push(...out)
    return out
  }
  plans.updateVendorPlanAssignments = async (u: Row | Row[]) =>
    (Array.isArray(u) ? u : [u]).map((x) => {
      const r = assignments.find((a) => a.id === x.id)
      if (r) Object.assign(r, x)
      return r
    })
  plans.listVendorPlanEvents = async (f: Record<string, unknown> = {}) =>
    events.filter((r) => matches(r, f))
  plans.createVendorPlanEvents = async (e: Row | Row[]) => {
    const out = (Array.isArray(e) ? e : [e]).map((x, i) => ({ ...x, id: `vpe_${events.length + i + 1}` }))
    events.push(...out)
    return out
  }

  const charges: Row[] = []
  const billing = Object.create(VendorBillingService.prototype) as Record<string, unknown>
  billing.listVendorCharges = async (where: Record<string, unknown> = {}) =>
    charges.filter((c) => Object.entries(where).every(([k, v]) => c[k] === v))
  billing.createVendorCharges = async (data: Row) => {
    const row = { ...data, id: `vc_${charges.length + 1}` }
    charges.push(row)
    return row
  }
  billing.updateVendorCharges = async (data: Row) => {
    const row = charges.find((c) => c.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }

  const scope = {
    resolve: (key: string) => {
      if (key === VENDOR_PLAN_MODULE) return plans
      if (key === VENDOR_BILLING_MODULE) return billing
      throw new Error(`unexpected container key: ${key}`)
    },
  }

  const call = async (
    handler: (req: never, res: never) => Promise<unknown>,
    req: { body?: Record<string, unknown>; query?: Record<string, unknown> }
  ) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown as Record<string, unknown>,
      status(code: number) {
        res.statusCode = code
        return res
      },
      json(payload: unknown) {
        res.body = payload as Record<string, unknown>
        return res
      },
    }
    await handler({ body: req.body ?? {}, query: req.query ?? {}, params: {}, scope } as never, res as never)
    return res
  }

  const preview = (plan_code: string) => call(PREVIEW, { query: { plan_code } })
  const change = (plan_code: string) =>
    call(CHANGE, { body: { plan_code, auto_renew_consent: true } })

  return { assignments, events, charges, preview, change }
}

const NOW = new Date("2026-10-05T12:00:00Z")

beforeEach(() => {
  clearPlanFeatureCache()
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] })
  jest.setSystemTime(NOW)
})

afterEach(() => {
  jest.useRealTimers()
  delete process.env[ENV]
})

describe("GET /vendor/plan/preview (flag on)", () => {
  beforeEach(() => {
    process.env[ENV] = "true"
  })

  it("first-time all_access: a 30-day trial, nothing today, first charge when it ends — and the change does exactly that", async () => {
    const world = makeWorld()
    const res = await world.preview("all_access")

    const trialEnd = new Date(NOW.getTime() + 30 * DAY).toISOString()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      plan_code: "all_access",
      display_name: expect.any(String),
      price_amount: 1000,
      currency_code: "usd",
      interval: "month",
      change: "upgrade",
      deferred: false,
      effective_at: null,
      trial_days: 30,
      trial_ends_at: trialEnd,
      charge_now_amount: 0,
      first_charge_at: trialEnd,
      renews: true,
      requires_auto_renew_consent: true,
    })
    // Read-only: no transition, no event beyond the auto-provisioned row.
    expect(world.assignments[0].plan_code).toBe("free")
    expect(world.events.map((e) => e.type)).toEqual(["assigned"])

    const done = await world.change("all_access")
    expect(done.statusCode).toBe(200)
    expect(world.assignments[0].status).toBe(VendorPlanStatus.TRIALING)
    expect(new Date(world.assignments[0].trial_ends_at as Date).toISOString()).toBe(trialEnd)
    expect(world.charges).toHaveLength(0)
  })

  it("returning all_access vendor: no trial, $10 today — and the change charges exactly that", async () => {
    const world = makeWorld()
    world.events.push({ id: "vpe_0", seller_id: SELLER, type: "upgraded", to_plan_code: "all_access", payload: { reason: "x" } })

    const res = await world.preview("all_access")
    expect(res.body).toMatchObject({
      deferred: false,
      trial_days: 0,
      trial_ends_at: null,
      charge_now_amount: 1000,
      first_charge_at: NOW.toISOString(),
    })

    await world.change("all_access")
    expect(world.assignments[0].status).toBe(VendorPlanStatus.ACTIVE)
    expect(world.charges.map((c) => c.amount)).toEqual([res.body.charge_now_amount])
  })

  it("a deferred move onto all_access: lands at period end, trial from that date, even though scheduling writes an event", async () => {
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: null,
      pending_effective_at: null,
    })

    const expected = {
      change: "downgrade",
      deferred: true,
      effective_at: effective.toISOString(),
      trial_days: 30,
      trial_ends_at: new Date(effective.getTime() + 30 * DAY).toISOString(),
      charge_now_amount: 0,
      first_charge_at: new Date(effective.getTime() + 30 * DAY).toISOString(),
    }
    expect((await world.preview("all_access")).body).toMatchObject(expected)

    // Scheduling it writes the DOWNGRADED row naming all_access; the trial
    // is still the seller's to take.
    expect((await world.change("all_access")).body.deferred).toBe(true)
    expect((await world.preview("all_access")).body).toMatchObject(expected)
  })

  it("a deferred move onto all_access with the trial spent: first charged the day it lands", async () => {
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
    })
    world.events.push({ id: "vpe_0", seller_id: SELLER, type: "upgraded", to_plan_code: "all_access", payload: null })

    expect((await world.preview("all_access")).body).toMatchObject({
      deferred: true,
      trial_days: 0,
      trial_ends_at: null,
      charge_now_amount: 0,
      first_charge_at: effective.toISOString(),
    })
  })

  it("moving to free from a trialing all_access: deferred to the trial's end, no charge", async () => {
    const world = makeWorld()
    await world.change("all_access")
    const res = await world.preview("free")
    expect(res.body).toMatchObject({
      plan_code: "free",
      deferred: true,
      effective_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      trial_days: 0,
      charge_now_amount: 0,
      first_charge_at: null,
      renews: false,
      requires_auto_renew_consent: false,
    })
  })

  it("gates exactly like the change route, with the same bodies", async () => {
    const world = makeWorld()
    for (const code of ["starter", "pro", "scale", "internal"]) {
      const res = await world.preview(code)
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ type: "forbidden", message: `Plan "${code}" cannot be selected directly` })
    }
    expect((await world.preview("nope")).statusCode).toBe(400)
    expect((await world.preview("")).statusCode).toBe(400)
    // Already on it.
    const already = await world.preview("free")
    expect(already.statusCode).toBe(400)
    expect(already.body.message).toBe("already on this plan")
  })
})

describe("GET /vendor/plan/preview (flag off)", () => {
  it("previews the original ladder and refuses all_access with the change route's body", async () => {
    const world = makeWorld()
    const off = await world.preview("all_access")
    expect(off.statusCode).toBe(403)
    expect(off.body).toEqual({ type: "forbidden", message: 'Plan "all_access" cannot be selected directly' })

    expect((await world.preview("starter")).body).toMatchObject({
      trial_days: 30,
      charge_now_amount: 0,
      requires_auto_renew_consent: false,
    })
    expect((await world.preview("scale")).body).toMatchObject({
      trial_days: 0,
      charge_now_amount: 24900,
      first_charge_at: NOW.toISOString(),
      requires_auto_renew_consent: false,
    })
  })
})
