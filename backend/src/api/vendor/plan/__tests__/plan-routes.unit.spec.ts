import { GET } from "../me/route"
import { POST as CHANGE } from "../change/route"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { featureKeysForPlan } from "../../../../modules/vendor-plan/catalog"
import { limitsForPlan } from "../../../../modules/vendor-plan/limits"

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

  return {
    req: {
      body,
      params: {},
      scope: {
        resolve: (key: string) => {
          if (key === VENDOR_PLAN_MODULE) return planService
          if (key === ENTITLEMENT_MODULE) return entitlementService
          return undefined
        },
      },
    },
    planService,
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
