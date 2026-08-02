import { requirePlanFeature } from "../require-plan-feature"
import {
  PLAN_CACHE_TTL_MS,
  clearPlanFeatureCache,
  invalidateSellerPlan,
  planFeatureCacheSize,
  PLAN_CACHE_MAX_ENTRIES,
  getCachedPlanFeatures,
  setCachedPlanFeatures,
} from "../../../shared/plan-entitlement-cache"
import { VENDOR_PLAN_MODULE } from "../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"

/**
 * Middleware harness following `shared/__tests__/csrf-guard.unit.spec.ts`:
 * hand-rolled req/res plus a jest.fn() `next`, asserting on which was called.
 */
type FakeRes = {
  statusCode: number
  body: Record<string, unknown>
  status: jest.Mock
  json: jest.Mock
}

const makeRes = (): FakeRes => {
  const res = { statusCode: 200, body: undefined } as unknown as FakeRes
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((payload: Record<string, unknown>) => {
    res.body = payload
    return res
  })
  return res
}

type HarnessOpts = {
  sellerShape?: "seller" | "_seller_id" | "seller_id" | "actor" | "none"
  sellerId?: string
  planCode?: string
  planKeys?: string[]
  entitlementKeys?: string[]
  planThrows?: boolean
  entitlementThrows?: boolean
  method?: string
}

const makeReq = (opts: HarnessOpts = {}) => {
  const sellerId = opts.sellerId ?? "sel_1"
  const shape = opts.sellerShape ?? "seller"

  const planService = {
    ensureAssignment: jest.fn(async () => {
      if (opts.planThrows) throw new Error("db down")
      return { id: "vpa_1", seller_id: sellerId, plan_code: opts.planCode ?? "free" }
    }),
    getEntitledFeatureKeys: jest.fn(async () => {
      if (opts.planThrows) throw new Error("db down")
      return opts.planKeys ?? []
    }),
  }

  const entitlementService = {
    listActiveFeatureKeysForSeller: jest.fn(async () => {
      if (opts.entitlementThrows) throw new Error("entitlement read failed")
      return opts.entitlementKeys ?? []
    }),
  }

  const req: Record<string, unknown> = {
    method: opts.method ?? "GET",
    scope: {
      resolve: (key: string) => {
        if (key === VENDOR_PLAN_MODULE) return planService
        if (key === ENTITLEMENT_MODULE) return entitlementService
        return undefined
      },
    },
  }

  if (shape === "seller") req.seller = { id: sellerId }
  if (shape === "_seller_id") req._seller_id = sellerId
  if (shape === "seller_id") req.seller_id = sellerId
  if (shape === "actor") req.auth_context = { actor_id: sellerId }

  return { req, planService, entitlementService }
}

beforeEach(() => {
  clearPlanFeatureCache()
  jest.restoreAllMocks()
})

describe("requirePlanFeature", () => {
  it("passes an entitled seller through", async () => {
    const { req } = makeReq({ planKeys: ["vendor.pos"] })
    const res = makeRes()
    const next = jest.fn()

    await requirePlanFeature("vendor.pos")(req as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it("denies an unentitled seller with 402 and an actionable body", async () => {
    const { req } = makeReq({ planCode: "starter", planKeys: ["vendor.embed"] })
    const res = makeRes()
    const next = jest.fn()

    await requirePlanFeature("vendor.pos")(req as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(402)
    // Superset of the three denial conventions in this codebase, so every
    // existing client shape keeps working.
    expect(res.body).toMatchObject({
      type: "plan_upgrade_required",
      code: "plan_upgrade_required",
      required_feature: "vendor.pos",
      current_plan: "starter",
    })
    expect(typeof res.body.message).toBe("string")
    expect(typeof res.body.upgrade_url).toBe("string")
  })

  it("uses 402 rather than 404, so the panel can tell a paywall from a kill switch", async () => {
    const { req } = makeReq()
    const res = makeRes()
    await requirePlanFeature("vendor.pos")(req as never, res as never, jest.fn())
    expect(res.statusCode).toBe(402)
    expect(res.statusCode).not.toBe(404)
  })

  describe("seller resolution", () => {
    it.each(["seller", "_seller_id", "seller_id", "actor"] as const)(
      "reads the seller from req.%s",
      async (shape) => {
        const { req } = makeReq({ sellerShape: shape, planKeys: ["vendor.pos"] })
        const res = makeRes()
        const next = jest.fn()
        await requirePlanFeature("vendor.pos")(req as never, res as never, next)
        expect(next).toHaveBeenCalled()
      }
    )

    it("ignores a mem_ actor id rather than treating it as a seller", async () => {
      const { req, planService } = makeReq({
        sellerShape: "actor",
        sellerId: "mem_123",
      })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos")(req as never, res as never, next)

      // Falls through rather than looking up a plan for a member id.
      expect(next).toHaveBeenCalled()
      expect(planService.ensureAssignment).not.toHaveBeenCalled()
    })

    it("calls next(), NOT 401, when no seller is present", async () => {
      // `ensureSellerContext` runs first and already 401s when it cannot
      // resolve a seller. Reaching here without one means a whitelisted public
      // route, so a second differently-shaped 401 would be a regression.
      const { req } = makeReq({ sellerShape: "none" })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos")(req as never, res as never, next)

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
  })

  describe("entitlement union", () => {
    it("opens the gate on a directly held entitlement outside the plan", async () => {
      // Comps, promos and one-off operator grants must work without inventing
      // a bespoke plan.
      const { req } = makeReq({ planKeys: [], entitlementKeys: ["vendor.pos"] })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos")(req as never, res as never, next)

      expect(next).toHaveBeenCalled()
    })

    it("still honours plan features when the entitlement read fails", async () => {
      const { req } = makeReq({
        planKeys: ["vendor.pos"],
        entitlementThrows: true,
      })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos")(req as never, res as never, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe("failure handling", () => {
    it("fails closed with 503, distinguishable from a paywall", async () => {
      // A 402 here would be a lie that fires an upsell at a paying vendor;
      // an open gate would hand out paid features on a database blip.
      const { req } = makeReq({ planThrows: true })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos")(req as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(503)
      expect(res.body).toMatchObject({ code: "plan_check_unavailable" })
    })

    it("does not cache a failed lookup", async () => {
      const { req } = makeReq({ planThrows: true })
      await requirePlanFeature("vendor.pos")(req as never, makeRes() as never, jest.fn())
      expect(planFeatureCacheSize()).toBe(0)
    })
  })

  describe("caching", () => {
    it("serves a second request without re-querying", async () => {
      const { req, planService } = makeReq({ planKeys: ["vendor.pos"] })
      const gate = requirePlanFeature("vendor.pos")

      await gate(req as never, makeRes() as never, jest.fn())
      await gate(req as never, makeRes() as never, jest.fn())

      expect(planService.getEntitledFeatureKeys).toHaveBeenCalledTimes(1)
    })

    it("refetches after invalidation, so an upgrade lands immediately", async () => {
      const { req, planService } = makeReq({ planKeys: ["vendor.pos"] })
      const gate = requirePlanFeature("vendor.pos")

      await gate(req as never, makeRes() as never, jest.fn())
      invalidateSellerPlan("sel_1")
      await gate(req as never, makeRes() as never, jest.fn())

      expect(planService.getEntitledFeatureKeys).toHaveBeenCalledTimes(2)
    })

    it("scopes the cache per seller", async () => {
      const a = makeReq({ sellerId: "sel_a", planKeys: ["vendor.pos"] })
      const b = makeReq({ sellerId: "sel_b", planKeys: [] })
      const gate = requirePlanFeature("vendor.pos")

      const resA = makeRes()
      const resB = makeRes()
      const nextA = jest.fn()
      const nextB = jest.fn()

      await gate(a.req as never, resA as never, nextA)
      await gate(b.req as never, resB as never, nextB)

      expect(nextA).toHaveBeenCalled()
      expect(nextB).not.toHaveBeenCalled()
      expect(resB.statusCode).toBe(402)
    })
  })

  describe("exceptMethods", () => {
    it("leaves excluded methods open", async () => {
      const { req, planService } = makeReq({ method: "GET", planKeys: [] })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos", { exceptMethods: ["GET"] })(req as never, res as never,
        next
      )

      expect(next).toHaveBeenCalled()
      expect(planService.ensureAssignment).not.toHaveBeenCalled()
    })

    it("still gates methods outside the exclusion", async () => {
      const { req } = makeReq({ method: "POST", planKeys: [] })
      const res = makeRes()
      const next = jest.fn()

      await requirePlanFeature("vendor.pos", { exceptMethods: ["GET"] })(req as never, res as never,
        next
      )

      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(402)
    })
  })
})

describe("plan-entitlement-cache", () => {
  beforeEach(() => clearPlanFeatureCache())

  it("expires an entry once the TTL passes", () => {
    const t0 = 1_000_000
    setCachedPlanFeatures(
      "sel_1",
      { plan_code: "pro", feature_keys: new Set(["vendor.pos"]) },
      t0
    )
    expect(getCachedPlanFeatures("sel_1", t0 + PLAN_CACHE_TTL_MS - 1)).not.toBeNull()
    expect(getCachedPlanFeatures("sel_1", t0 + PLAN_CACHE_TTL_MS)).toBeNull()
  })

  it("bounds its size, so forged seller contexts cannot grow it without limit", () => {
    for (let i = 0; i < PLAN_CACHE_MAX_ENTRIES + 25; i++) {
      setCachedPlanFeatures(`sel_${i}`, {
        plan_code: "free",
        feature_keys: new Set(),
      })
    }
    expect(planFeatureCacheSize()).toBeLessThanOrEqual(PLAN_CACHE_MAX_ENTRIES)
  })

  it("evicts oldest-first when at capacity", () => {
    for (let i = 0; i < PLAN_CACHE_MAX_ENTRIES; i++) {
      setCachedPlanFeatures(`sel_${i}`, {
        plan_code: "free",
        feature_keys: new Set(),
      })
    }
    setCachedPlanFeatures("sel_new", {
      plan_code: "free",
      feature_keys: new Set(),
    })
    expect(getCachedPlanFeatures("sel_0")).toBeNull()
    expect(getCachedPlanFeatures("sel_new")).not.toBeNull()
  })
})
