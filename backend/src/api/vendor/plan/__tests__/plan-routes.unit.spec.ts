import { GET } from "../me/route"
import { POST as CHANGE } from "../change/route"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import VendorBillingService from "../../../../modules/vendor-billing/service"
import {
  featureKeysForPlan,
  getPlanDefinition,
} from "../../../../modules/vendor-plan/catalog"
import { limitsForPlan } from "../../../../modules/vendor-plan/limits"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"

const ALL_ACCESS_ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1

afterEach(() => {
  // Flag specs mutate process.env; a leaked value flips later specs.
  delete process.env[ALL_ACCESS_ENV]
})

/**
 * Route-handler harness per `api/vendor/__tests__/invoices-route.unit.spec.ts`.
 * `requireSellerId` is mocked because these tests are about plan behaviour, not
 * the seller-resolution chain (which has its own cover).
 */
jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type Opts = {
  planCode?: string
  planKeys?: string[]
  entitlementKeys?: string[]
  entitlementThrows?: boolean
  transitionResult?: Record<string, unknown>
}

const makeReq = (body: Record<string, unknown> = {}, opts: Opts = {}) => {
  const planService = {
    ensureAssignment: jest.fn(async () => ({
      id: "vpa_1",
      seller_id: "sel_1",
      plan_code: opts.planCode ?? "free",
      status: "active",
      current_period_end: null,
      trial_ends_at: null,
      cancel_at_period_end: false,
      pending_plan_code: null,
      pending_effective_at: null,
    })),
    getEntitledFeatureKeys: jest.fn(async () => opts.planKeys ?? []),
    applyPlanTransition: jest.fn(
      async () =>
        opts.transitionResult ?? {
          assignment: {
            plan_code: "pro",
            status: "active",
            current_period_end: null,
            pending_plan_code: null,
            pending_effective_at: null,
          },
          decision: { kind: "immediate", change: "upgrade" },
          replayed: false,
        }
    ),
  }

  const entitlementService = {
    listActiveFeatureKeysForSeller: jest.fn(async () => {
      if (opts.entitlementThrows) throw new Error("boom")
      return opts.entitlementKeys ?? []
    }),
  }

  // The REAL billing service over in-memory rows, so the route's charge goes
  // through the real idempotency and normalization paths.
  const billingCharges: Record<string, unknown>[] = []
  const billingService = Object.create(
    VendorBillingService.prototype
  ) as Record<string, unknown>
  billingService.listVendorCharges = (async (
    where: Record<string, unknown> = {}
  ) =>
    billingCharges.filter((c) =>
      Object.entries(where).every(([k, v]) => c[k] === v)
    )) as never
  billingService.createVendorCharges = (async (
    data: Record<string, unknown>
  ) => {
    const row = { ...data, id: `vc_${billingCharges.length + 1}` }
    billingCharges.push(row)
    return row
  }) as never
  billingService.updateVendorCharges = (async (
    data: Record<string, unknown>
  ) => {
    const row = billingCharges.find((c) => c.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  return {
    req: {
      body,
      params: {},
      scope: {
        resolve: (key: string) => {
          if (key === VENDOR_PLAN_MODULE) return planService
          if (key === ENTITLEMENT_MODULE) return entitlementService
          if (key === VENDOR_BILLING_MODULE) return billingService
          return undefined
        },
      },
    },
    planService,
    billingCharges,
  }
}

describe("GET /vendor/plan/me", () => {
  it("returns the seller's plan", async () => {
    const { req } = makeReq({}, { planCode: "pro" })
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect((res.body.plan as Record<string, unknown>).code).toBe("pro")
  })

  it("returns the union of plan features and direct entitlements", async () => {
    // Must match what the gate enforces, or the UI and the gate disagree.
    const { req } = makeReq(
      {},
      { planKeys: ["vendor.embed"], entitlementKeys: ["vendor.pos"] }
    )
    const res = createRes()
    await GET(req as never, res as never)

    expect((res.body.feature_keys as string[]).sort()).toEqual([
      "vendor.embed",
      "vendor.pos",
    ])
  })

  it("still returns the plan when the entitlement read fails", async () => {
    const { req } = makeReq(
      {},
      { planKeys: ["vendor.embed"], entitlementThrows: true }
    )
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.feature_keys).toEqual(["vendor.embed"])
  })

  it("offers only self-serve plans", async () => {
    // `internal` is operator-assigned; a vendor must not be able to pick it.
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    const codes = (res.body.available_plans as { code: string }[]).map(
      (p) => p.code
    )
    expect(codes).toContain("free")
    expect(codes).not.toContain("internal")
  })

  it("reports the plan's quantitative limits", async () => {
    // Without these the vendor only discovers a cap by hitting it.
    const { req } = makeReq({}, { planCode: "pro" })
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.body.limits).toEqual(limitsForPlan("pro"))
  })

  it("reports the plan's take rate", async () => {
    // The lower commission is the reason to upgrade that is not a feature, so
    // the upgrade screen has to be able to show it.
    const { req } = makeReq({}, { planCode: "pro" })
    const res = createRes()
    await GET(req as never, res as never)

    expect((res.body.plan as Record<string, unknown>).platform_fee_percent).toBe(
      getPlanDefinition("pro")?.platform_fee_percent
    )
  })

  it("quotes a take rate for every plan it offers", async () => {
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    const plans = res.body.available_plans as {
      code: string
      platform_fee_percent: number | null
    }[]
    for (const plan of plans) {
      expect(plan.platform_fee_percent).toBe(
        getPlanDefinition(plan.code)?.platform_fee_percent
      )
      expect(plan.platform_fee_percent).not.toBeNull()
    }
  })

  it("reports each offered plan's features, for the upgrade screen", async () => {
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    const pro = (res.body.available_plans as { code: string; feature_keys: string[] }[]).find(
      (p) => p.code === "pro"
    )
    expect(pro?.feature_keys).toEqual(featureKeysForPlan("pro"))
  })
})

describe("POST /vendor/plan/change", () => {
  it("requires a plan_code", async () => {
    const { req } = makeReq({})
    const res = createRes()
    await CHANGE(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("rejects an unknown plan", async () => {
    const { req } = makeReq({ plan_code: "enterprise-deluxe" })
    const res = createRes()
    await CHANGE(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("refuses an operator-assigned plan", async () => {
    // Otherwise any vendor could put themselves on the all-features plan.
    const { req, planService } = makeReq({ plan_code: "internal" })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(403)
    expect(planService.applyPlanTransition).not.toHaveBeenCalled()
  })

  it("applies an upgrade", async () => {
    const { req } = makeReq({ plan_code: "pro" })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(res.body.deferred).toBe(false)
  })

  it("records a prorated charge for an immediate paid upgrade", async () => {
    // Access first, collection second: the plan applied, and the charge sits
    // in the ledger. Billing is unconfigured in tests, so execution reports
    // the charge still pending — recorded, not collected.
    const periodStart = new Date("2026-08-01T00:00:00Z")
    const periodEnd = new Date("2100-01-31T00:00:00Z")
    const { req, billingCharges } = makeReq(
      { plan_code: "pro" },
      {
        transitionResult: {
          assignment: {
            plan_code: "pro",
            status: "active",
            current_period_start: periodStart,
            current_period_end: periodEnd,
            pending_plan_code: null,
            pending_effective_at: null,
          },
          decision: { kind: "immediate", change: "upgrade" },
          replayed: false,
        },
      }
    )
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(billingCharges).toHaveLength(1)
    expect(billingCharges[0]).toMatchObject({
      seller_id: "sel_1",
      kind: "plan",
      status: "pending",
      idempotency_key: `plan:sel_1:pro:${periodEnd.toISOString()}`,
    })
    // Prorated to the remaining period, capped at the full price.
    expect(billingCharges[0].amount).toBeLessThanOrEqual(9900)
    expect(billingCharges[0].amount).toBeGreaterThan(0)
    expect(res.body.charge_status).toBe("pending")
  })

  it("charges nothing for a deferred downgrade", async () => {
    const { req, billingCharges } = makeReq(
      { plan_code: "starter" },
      {
        transitionResult: {
          assignment: {
            plan_code: "pro",
            status: "active",
            current_period_end: null,
            pending_plan_code: "starter",
            pending_effective_at: new Date("2026-09-01"),
          },
          decision: { kind: "deferred", change: "downgrade" },
          replayed: false,
        },
      }
    )
    await CHANGE(req as never, createRes() as never)
    expect(billingCharges).toHaveLength(0)
  })

  it("does not re-charge a replayed transition", async () => {
    // The transition idempotency already fired once; charging again on the
    // replay would bill the same upgrade twice.
    const { req, billingCharges } = makeReq(
      { plan_code: "pro" },
      {
        transitionResult: {
          assignment: { plan_code: "pro", status: "active" },
          decision: { kind: "immediate", change: "upgrade" },
          replayed: true,
        },
      }
    )
    await CHANGE(req as never, createRes() as never)
    expect(billingCharges).toHaveLength(0)
  })

  it("still applies the plan when the charge write blows up", async () => {
    // Collection must never gate access — an uncollected charge is exactly
    // what the ledger exists to remember.
    const { req, billingCharges } = makeReq({ plan_code: "pro" })
    billingCharges.push = () => {
      throw new Error("db down")
    }
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(res.body.charge_status).toBeNull()
  })

  it("reports a deferred downgrade rather than implying it applied", async () => {
    const { req } = makeReq(
      { plan_code: "starter" },
      {
        transitionResult: {
          assignment: {
            plan_code: "pro",
            status: "active",
            current_period_end: null,
            pending_plan_code: "starter",
            pending_effective_at: new Date("2026-09-01"),
          },
          decision: { kind: "deferred", change: "downgrade" },
          replayed: false,
        },
      }
    )
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.body.applied).toBe(false)
    expect(res.body.deferred).toBe(true)
    expect((res.body.plan as Record<string, unknown>).pending_plan_code).toBe(
      "starter"
    )
  })

  it("surfaces a rejected transition as a 400", async () => {
    const { req } = makeReq(
      { plan_code: "pro" },
      {
        transitionResult: {
          assignment: { plan_code: "pro", status: "active" },
          decision: { kind: "rejected", reason: "already on this plan" },
          replayed: false,
        },
      }
    )
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(400)
  })

  it("treats a replay as success, not an error", async () => {
    const { req } = makeReq(
      { plan_code: "pro", idempotency_key: "evt_1" },
      {
        transitionResult: {
          assignment: { plan_code: "pro", status: "active" },
          decision: { kind: "rejected", reason: "replayed idempotency key" },
          replayed: true,
        },
      }
    )
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.replayed).toBe(true)
  })
})

describe("offered-set gating (FF_ALL_ACCESS_PLAN_V1)", () => {
  /** The pre-F8 available_plans row, built field by field from the catalog. */
  const availableRow = (code: string) => {
    const p = getPlanDefinition(code)!
    return {
      code: p.code,
      display_name: p.display_name,
      description: p.description,
      price_amount: p.price_amount,
      currency_code: p.currency_code,
      interval: p.interval,
      trial_days: p.trial_days,
      display_order: p.display_order,
      feature_keys: p.feature_keys,
      limits: limitsForPlan(p.code),
      platform_fee_percent: p.platform_fee_percent,
    }
  }

  it("plan/me offers exactly the pre-F8 ladder, byte for byte, with the flag off", async () => {
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.body.available_plans).toEqual(
      ["free", "starter", "pro", "scale"].map(availableRow)
    )
  })

  it("plan/me offers free and all_access with the flag on", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.body.available_plans).toEqual(
      ["free", "all_access"].map(availableRow)
    )
    const all = (res.body.available_plans as Record<string, unknown>[])[1]
    expect(all).toMatchObject({
      price_amount: 1000,
      interval: "month",
      trial_days: 30,
      platform_fee_percent: 0,
    })
    expect(all.limits).toEqual(limitsForPlan("all_access"))
  })

  it("plan/me still reports a retired plan a seller is on, with its features and limits", async () => {
    // Retired tiers stay defined; only the offer changes.
    process.env[ALL_ACCESS_ENV] = "true"
    const { req } = makeReq({}, { planCode: "pro" })
    const res = createRes()
    await GET(req as never, res as never)

    expect((res.body.plan as Record<string, unknown>).code).toBe("pro")
    expect((res.body.plan as Record<string, unknown>).platform_fee_percent).toBe(2)
    expect(res.body.limits).toEqual(limitsForPlan("pro"))
  })

  it("plan/change refuses a retired tier with the flag on, with the same 403 body as an operator plan", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    for (const code of ["starter", "pro", "scale"]) {
      const { req, planService } = makeReq({ plan_code: code })
      const res = createRes()
      await CHANGE(req as never, res as never)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({
        type: "forbidden",
        message: `Plan "${code}" cannot be selected directly`,
      })
      expect(planService.applyPlanTransition).not.toHaveBeenCalled()
    }

    // Same shape as the is_public refusal, so the two are indistinguishable.
    const { req } = makeReq({ plan_code: "internal" })
    const res = createRes()
    await CHANGE(req as never, res as never)
    expect(res.statusCode).toBe(403)
    expect(Object.keys(res.body).sort()).toEqual(["message", "type"])
    expect(res.body.type).toBe("forbidden")
  })

  it("plan/change accepts all_access with the flag on", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    const { req, planService, billingCharges } = makeReq(
      { plan_code: "all_access", auto_renew_consent: true },
      {
        transitionResult: {
          assignment: {
            plan_code: "all_access",
            status: "trialing",
            current_period_end: new Date("2026-11-04T00:00:00Z"),
            pending_plan_code: null,
            pending_effective_at: null,
          },
          decision: { kind: "immediate", change: "upgrade" },
          replayed: false,
        },
      }
    )
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(planService.applyPlanTransition).toHaveBeenCalledWith(
      expect.objectContaining({ seller_id: "sel_1", to_plan_code: "all_access" })
    )
    // Trialing: nothing billed on signup.
    expect(billingCharges).toHaveLength(0)
  })

  it("plan/change refuses all_access with the flag on but no auto-renew approval", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    const { req, planService } = makeReq({ plan_code: "all_access" })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe("invalid_data")
    expect(planService.applyPlanTransition).not.toHaveBeenCalled()
  })

  it("plan/change passes the seller-scoped key and the recorded approval to the service", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    const { req, planService } = makeReq({
      plan_code: "all_access",
      idempotency_key: "panel:abc",
      auto_renew_consent: true,
    })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(planService.applyPlanTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "vendor:sel_1:panel:abc",
        event_payload: expect.objectContaining({ auto_renew_consent: true }),
      })
    )
  })

  it("plan/change with the flag off needs no approval and records none", async () => {
    const { req, planService } = makeReq({ plan_code: "starter" })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    const input = (planService.applyPlanTransition.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(input).not.toHaveProperty("event_payload")
    expect(input.idempotency_key).toBeNull()
  })

  it("plan/change refuses all_access with the flag off, same body", async () => {
    const { req, planService } = makeReq({ plan_code: "all_access" })
    const res = createRes()
    await CHANGE(req as never, res as never)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      type: "forbidden",
      message: 'Plan "all_access" cannot be selected directly',
    })
    expect(planService.applyPlanTransition).not.toHaveBeenCalled()
  })

  it("plan/change still accepts the paid tiers with the flag off", async () => {
    for (const code of ["starter", "pro", "scale"]) {
      const { req, planService } = makeReq({ plan_code: code })
      const res = createRes()
      await CHANGE(req as never, res as never)
      expect(res.statusCode).toBe(200)
      expect(planService.applyPlanTransition).toHaveBeenCalledTimes(1)
    }
  })
})
