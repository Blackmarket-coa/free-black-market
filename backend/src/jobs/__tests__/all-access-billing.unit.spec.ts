import { processPlanRenewals } from "../vendor-plan-renewals"
import { POST as CHANGE } from "../../api/vendor/plan/change/route"
import VendorPlanService from "../../modules/vendor-plan/service"
import VendorBillingService from "../../modules/vendor-billing/service"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { VENDOR_BILLING_MODULE } from "../../modules/vendor-billing"
import { VendorPlanStatus } from "../../modules/vendor-plan/models"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"
import { requireSellerId } from "../../shared"

/**
 * Black Mask F8, operator answer OI-8: the $10 all-access plan has a 30-day
 * trial and the first $10 must actually be raised when it ends — exactly once.
 *
 * Everything on the money path here is REAL: the plan/change route handler,
 * `VendorPlanService` (prototype + in-memory CRUD that enforces the event
 * idempotency index, the `service.unit.spec.ts` harness), `VendorBillingService`
 * (prototype + in-memory rows, so the charge key and its replay are the real
 * ones), and the renewal job. Only `requireSellerId` is stubbed. Modules are
 * keyed on their imported constants and the container throws on anything
 * else, so a wrong key fails loudly instead of exercising a fallback.
 */

jest.mock("../../shared", () => ({
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
      return (
        row[k] != null &&
        new Date(row[k] as Date).getTime() <= new Date(bound).getTime()
      )
    }
    return row[k] === v
  })

function makePlans() {
  const assignments: Row[] = []
  const events: Row[] = []
  const svc = Object.create(VendorPlanService.prototype) as Record<string, unknown>

  svc.listVendorPlanAssignments = async (f: Record<string, unknown> = {}) =>
    assignments.filter((r) => matches(r, f))
  svc.createVendorPlanAssignments = async (e: Row | Row[]) => {
    const out = (Array.isArray(e) ? e : [e]).map((x, i) => ({
      ...x,
      id: `vpa_${assignments.length + i + 1}`,
    }))
    assignments.push(...out)
    return out
  }
  svc.updateVendorPlanAssignments = async (u: Row | Row[]) =>
    (Array.isArray(u) ? u : [u]).map((x) => {
      const r = assignments.find((a) => a.id === x.id)
      if (r) Object.assign(r, x)
      return r
    })
  svc.listVendorPlanEvents = async (f: Record<string, unknown> = {}) =>
    events.filter((r) => matches(r, f))
  svc.createVendorPlanEvents = async (e: Row | Row[]) => {
    const entries = Array.isArray(e) ? e : [e]
    for (const x of entries) {
      if (x.idempotency_key && events.some((ev) => ev.idempotency_key === x.idempotency_key)) {
        const err = new Error("duplicate key") as Error & { code: string }
        err.code = "23505"
        throw err
      }
    }
    const out = entries.map((x, i) => ({ ...x, id: `vpe_${events.length + i + 1}` }))
    events.push(...out)
    return out
  }

  return {
    service: svc as unknown as VendorPlanService,
    assignments,
    events,
  }
}

function makeBilling() {
  const charges: Row[] = []
  const svc = Object.create(VendorBillingService.prototype) as Record<string, unknown>
  svc.listVendorCharges = async (where: Record<string, unknown> = {}) =>
    charges.filter((c) => Object.entries(where).every(([k, v]) => c[k] === v))
  svc.createVendorCharges = async (data: Row) => {
    if (charges.some((c) => c.idempotency_key === data.idempotency_key)) {
      const err = new Error("duplicate key") as Error & { code: string }
      err.code = "23505"
      throw err
    }
    const row = { ...data, id: `vc_${charges.length + 1}` }
    charges.push(row)
    return row
  }
  svc.updateVendorCharges = async (data: Row) => {
    const row = charges.find((c) => c.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }
  return { service: svc as unknown as VendorBillingService, charges }
}

function makeWorld() {
  const plans = makePlans()
  const billing = makeBilling()
  const resolve = jest.fn((key: string) => {
    if (key === VENDOR_PLAN_MODULE) return plans.service
    if (key === VENDOR_BILLING_MODULE) return billing.service
    throw new Error(`unexpected container key: ${key}`)
  })
  const container = { resolve }
  return { plans, billing, container, resolve }
}

const createRes = () => {
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
  return res
}

async function changePlan(
  world: ReturnType<typeof makeWorld>,
  plan_code: string,
  extra: Record<string, unknown> = {}
) {
  const res = createRes()
  // The panel's confirm step sends the vendor's renewal approval; the route
  // ignores it for a free plan and with the flag off.
  await CHANGE(
    {
      body: { plan_code, auto_renew_consent: true, ...extra },
      params: {},
      scope: world.container,
    } as never,
    res as never
  )
  return res
}

const assignmentOf = (world: ReturnType<typeof makeWorld>) =>
  world.plans.assignments.find((a) => a.seller_id === SELLER)!

const addMonth = (d: Date) => {
  const out = new Date(d)
  out.setUTCMonth(out.getUTCMonth() + 1)
  return out
}

beforeEach(() => {
  clearPlanFeatureCache()
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] })
  jest.setSystemTime(new Date("2026-10-05T12:00:00Z"))
})

afterEach(() => {
  jest.useRealTimers()
  delete process.env[ENV]
})

describe("all_access trial, then the first $10 (flag on)", () => {
  beforeEach(() => {
    process.env[ENV] = "true"
  })

  it("trials on signup, bills nothing, then raises exactly one $10 charge when the trial ends", async () => {
    const world = makeWorld()
    const signup = new Date()

    const res = await changePlan(world, "all_access")
    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)

    const a = assignmentOf(world)
    const trialEnd = new Date(signup.getTime() + 30 * DAY)
    expect(a.plan_code).toBe("all_access")
    expect(a.status).toBe(VendorPlanStatus.TRIALING)
    expect(new Date(a.trial_ends_at as Date).getTime()).toBe(trialEnd.getTime())
    expect(new Date(a.current_period_end as Date).getTime()).toBe(trialEnd.getTime())
    // A free trial is free: nothing raised on signup.
    expect(world.billing.charges).toHaveLength(0)
    expect(res.body.charge_status).toBeNull()

    // The hour before the trial ends: still nothing.
    await processPlanRenewals(world.container as never, new Date(trialEnd.getTime() - 3_600_000))
    expect(world.billing.charges).toHaveLength(0)

    // The hour after: the first charge, for the first paid month.
    const tick = new Date(trialEnd.getTime() + 3_600_000)
    const outcomes = await processPlanRenewals(world.container as never, tick)
    expect(outcomes).toEqual([
      { seller_id: SELLER, action: "renewed", charge_status: "pending" },
    ])
    expect(world.billing.charges).toHaveLength(1)
    expect(world.billing.charges[0]).toMatchObject({
      seller_id: SELLER,
      kind: "plan",
      amount: 1000,
      currency_code: "usd",
      status: "pending",
      idempotency_key: `plan:${SELLER}:all_access:${addMonth(trialEnd).toISOString()}`,
    })
    expect(Number.isInteger(world.billing.charges[0].amount)).toBe(true)
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.ACTIVE)

    // Exactly once: re-running the same tick, or the next hour, raises nothing.
    await processPlanRenewals(world.container as never, tick)
    await processPlanRenewals(world.container as never, new Date(tick.getTime() + 3_600_000))
    expect(world.billing.charges).toHaveLength(1)
  })

  it("replays the first charge from the record when the roll after it failed", async () => {
    // Charge-first: the key is derived from the record (plan + new period end),
    // so a crash between charge and roll replays rather than double-billing.
    const world = makeWorld()
    await changePlan(world, "all_access")
    const trialEnd = new Date(assignmentOf(world).current_period_end as Date)
    const tick = new Date(trialEnd.getTime() + 3_600_000)

    const realUpdate = (world.plans.service as unknown as Record<string, unknown>)
      .updateVendorPlanAssignments as (u: Row | Row[]) => Promise<unknown>
    let failNext = true
    ;(world.plans.service as unknown as Record<string, unknown>).updateVendorPlanAssignments =
      async (u: Row | Row[]) => {
        if (failNext) {
          failNext = false
          throw new Error("db blip")
        }
        return realUpdate(u)
      }

    const first = await processPlanRenewals(world.container as never, tick)
    expect(first[0].action).toBe("failed")
    expect(world.billing.charges).toHaveLength(1)

    await processPlanRenewals(world.container as never, tick)
    expect(world.billing.charges).toHaveLength(1)
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.ACTIVE)
  })

  it("does not restart the trial for a seller who has already had it", async () => {
    // free → all_access (trial) → back to free at the trial's end → all_access
    // again. Without the once-per-seller rule this loop never bills.
    const world = makeWorld()
    await changePlan(world, "all_access")
    const trialEnd = new Date(assignmentOf(world).current_period_end as Date)

    const cancel = await changePlan(world, "free")
    expect(cancel.body.deferred).toBe(true)

    // The downgrade applies at the trial's end, before anything bills.
    const tick = new Date(trialEnd.getTime() + 3_600_000)
    await processPlanRenewals(world.container as never, tick)
    expect(assignmentOf(world).plan_code).toBe("free")
    expect(world.billing.charges).toHaveLength(0)

    jest.setSystemTime(tick)
    const again = await changePlan(world, "all_access")
    expect(again.statusCode).toBe(200)
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.ACTIVE)
    // Billed now, for the period that starts now: the full $10, once.
    expect(world.billing.charges).toHaveLength(1)
    expect(world.billing.charges[0]).toMatchObject({ kind: "plan", amount: 1000 })
  })

  it("bills the first period when a pending change lands on all_access with no trial left", async () => {
    // The map's F8-3 defect: applyPendingChange opened a paid period with no
    // charge and pass 2 could not see it. Anchored to pending_effective_at.
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: "all_access",
      pending_effective_at: effective,
      trial_ends_at: null,
    })
    // They held all_access before, so the trial is spent.
    world.plans.events.push({
      id: "vpe_0",
      seller_id: SELLER,
      type: "upgraded",
      to_plan_code: "all_access",
    })

    const tick = new Date(effective.getTime() + 3_600_000)
    const outcomes = await processPlanRenewals(world.container as never, tick)

    const periodEnd = addMonth(effective)
    expect(outcomes).toEqual([
      { seller_id: SELLER, action: "pending_applied", charge_status: "pending" },
    ])
    expect(world.billing.charges).toHaveLength(1)
    expect(world.billing.charges[0]).toMatchObject({
      amount: 1000,
      kind: "plan",
      idempotency_key: `plan:${SELLER}:all_access:${periodEnd.toISOString()}`,
    })
    const a = assignmentOf(world)
    expect(a.plan_code).toBe("all_access")
    expect(a.status).toBe(VendorPlanStatus.ACTIVE)
    // The period the charge covers is the period the assignment now holds.
    expect(new Date(a.current_period_start as Date).getTime()).toBe(effective.getTime())
    expect(new Date(a.current_period_end as Date).getTime()).toBe(periodEnd.getTime())

    // Nothing more this period, however often the cron runs.
    await processPlanRenewals(world.container as never, tick)
    await processPlanRenewals(world.container as never, new Date(tick.getTime() + DAY))
    expect(world.billing.charges).toHaveLength(1)
  })

  it("replays, not repeats, the first-period charge when the apply after it failed", async () => {
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: "all_access",
      pending_effective_at: effective,
    })
    world.plans.events.push({
      id: "vpe_0",
      seller_id: SELLER,
      type: "upgraded",
      to_plan_code: "all_access",
    })
    const svc = world.plans.service as unknown as Record<string, unknown>
    const realApply = VendorPlanService.prototype.applyPendingChange
    svc.applyPendingChange = jest.fn(async () => {
      throw new Error("db blip")
    })

    // Charge written, apply failed. A LATER tick must derive the same key.
    await processPlanRenewals(world.container as never, new Date(effective.getTime() + 3_600_000))
    expect(world.billing.charges).toHaveLength(1)

    svc.applyPendingChange = realApply
    await processPlanRenewals(world.container as never, new Date(effective.getTime() + 5 * 3_600_000))
    expect(world.billing.charges).toHaveLength(1)
    expect(assignmentOf(world).plan_code).toBe("all_access")
  })

  it("starts a trial, not a charge, when a move onto all_access SCHEDULED through plan/change lands for the first time", async () => {
    // A seller on a retired tier (operator-assigned; OI-6 says none today)
    // picks all_access in the panel. Cheaper, so it is deferred to the end of
    // the paid period — and scheduling it writes a DOWNGRADED event naming
    // all_access before the seller holds it. That row must not count as
    // "already had the trial".
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: null,
      pending_effective_at: null,
      trial_ends_at: null,
    })

    const scheduled = await changePlan(world, "all_access")
    expect(scheduled.statusCode).toBe(200)
    expect(scheduled.body.deferred).toBe(true)
    expect(assignmentOf(world).pending_plan_code).toBe("all_access")
    // The scheduling row the real route wrote — the one that used to be
    // mistaken for having held the plan.
    expect(
      world.plans.events.filter(
        (e) => e.type === "downgraded" && e.to_plan_code === "all_access"
      )
    ).toHaveLength(1)

    const tick = new Date(effective.getTime() + 3_600_000)
    const landed = await processPlanRenewals(world.container as never, tick)
    expect(landed).toEqual([{ seller_id: SELLER, action: "pending_applied" }])
    expect(world.billing.charges).toHaveLength(0)
    const a = assignmentOf(world)
    expect(a.plan_code).toBe("all_access")
    expect(a.status).toBe(VendorPlanStatus.TRIALING)
    const trialEnd = new Date(a.current_period_end as Date)
    expect(trialEnd.getTime()).toBe(tick.getTime() + 30 * DAY)

    // ...and the trial's end raises the first charge, exactly once.
    await processPlanRenewals(world.container as never, new Date(trialEnd.getTime() + 3_600_000))
    await processPlanRenewals(world.container as never, new Date(trialEnd.getTime() + 2 * 3_600_000))
    expect(world.billing.charges).toHaveLength(1)
    expect(world.billing.charges[0]).toMatchObject({ amount: 1000, kind: "plan" })
  })

  it("does not spend the trial on a scheduled move to all_access that was superseded", async () => {
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "scale",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: null,
      pending_effective_at: null,
      trial_ends_at: null,
    })
    expect((await changePlan(world, "all_access")).body.deferred).toBe(true)
    // Changed their mind: free instead, replacing the pending all_access.
    expect((await changePlan(world, "free")).body.deferred).toBe(true)
    expect(assignmentOf(world).pending_plan_code).toBe("free")

    const tick = new Date(effective.getTime() + 3_600_000)
    await processPlanRenewals(world.container as never, tick)
    expect(assignmentOf(world).plan_code).toBe("free")

    jest.setSystemTime(tick)
    const res = await changePlan(world, "all_access")
    expect(res.statusCode).toBe(200)
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.TRIALING)
    expect(world.billing.charges).toHaveLength(0)
  })

  it("records the vendor's auto-renew approval on the transition", async () => {
    const world = makeWorld()
    await changePlan(world, "all_access")
    const up = world.plans.events.find(
      (e) => e.type === "upgraded" && e.to_plan_code === "all_access"
    )!
    expect(up.payload).toMatchObject({
      auto_renew_consent: true,
      auto_renew_consent_at: new Date().toISOString(),
    })
  })

  it("refuses to start all_access without the vendor's auto-renew approval, writing nothing", async () => {
    const world = makeWorld()
    for (const consent of [undefined, false, "true", 1]) {
      const res = await changePlan(world, "all_access", { auto_renew_consent: consent })
      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_data")
    }
    expect(world.plans.assignments).toHaveLength(0)
    expect(world.plans.events).toHaveLength(0)
    expect(world.billing.charges).toHaveLength(0)
  })

  it("keeps two vendors' identical idempotency keys apart", async () => {
    // The panel used to send `panel:<plan>:<date>`, the same for every vendor
    // that day; keys are unique across sellers, so the second vendor got a
    // silent replay and stayed on free. The route now scopes keys by seller.
    const world = makeWorld()
    const key = "panel:all_access:2026-10-05"

    const first = await changePlan(world, "all_access", { idempotency_key: key })
    ;(requireSellerId as jest.Mock).mockResolvedValueOnce("sel_2")
    const second = await changePlan(world, "all_access", { idempotency_key: key })

    expect(first.body).toMatchObject({ applied: true, replayed: false })
    expect(second.statusCode).toBe(200)
    expect(second.body).toMatchObject({ applied: true, replayed: false })
    const bySeller = Object.fromEntries(
      world.plans.assignments.map((a) => [a.seller_id, [a.plan_code, a.status]])
    )
    expect(bySeller).toEqual({
      sel_1: ["all_access", VendorPlanStatus.TRIALING],
      sel_2: ["all_access", VendorPlanStatus.TRIALING],
    })

    // The same seller resending the same key is still a replay.
    const again = await changePlan(world, "all_access", { idempotency_key: key })
    expect(again.body).toMatchObject({ replayed: true })
  })

  it("raises no first-period charge for a pending cancellation to free", async () => {
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "all_access",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: "free",
      pending_effective_at: effective,
    })
    await processPlanRenewals(world.container as never, new Date(effective.getTime() + 3_600_000))
    expect(world.billing.charges).toHaveLength(0)
    expect(assignmentOf(world).plan_code).toBe("free")
  })
})

describe("with FF_ALL_ACCESS_PLAN_V1 off, the job behaves exactly as before", () => {
  it("applies a pending change without raising a charge, period from now", async () => {
    // The pre-existing behaviour for free → starter etc. is NOT changed by the
    // fix: it is scoped to the flag. Pinned so a later change has to say so.
    const world = makeWorld()
    const effective = new Date("2026-11-01T00:00:00Z")
    world.plans.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "internal",
      status: VendorPlanStatus.ACTIVE,
      current_period_end: effective,
      pending_plan_code: "scale",
      pending_effective_at: effective,
    })

    const tick = new Date(effective.getTime() + 3_600_000)
    const outcomes = await processPlanRenewals(world.container as never, tick)

    expect(outcomes).toEqual([{ seller_id: SELLER, action: "pending_applied" }])
    expect(world.billing.charges).toHaveLength(0)
    const a = assignmentOf(world)
    expect(a.plan_code).toBe("scale")
    expect(new Date(a.current_period_start as Date).getTime()).toBe(tick.getTime())
  })

  it("trials starter on every move onto it, as before", async () => {
    // The once-per-seller trial rule is all_access only.
    const world = makeWorld()
    await changePlan(world, "starter")
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.TRIALING)
    const trialEnd = new Date(assignmentOf(world).current_period_end as Date)

    await changePlan(world, "free")
    await processPlanRenewals(world.container as never, new Date(trialEnd.getTime() + 3_600_000))
    jest.setSystemTime(new Date(trialEnd.getTime() + 3_600_000))

    await changePlan(world, "starter")
    expect(assignmentOf(world).status).toBe(VendorPlanStatus.TRIALING)
    expect(world.billing.charges).toHaveLength(0)
  })
})
