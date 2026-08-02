import {
  getSellerPlanLimits,
  getSellerPlanSnapshot,
  respondPlanLimitReached,
} from "../seller-plan"
import {
  clearPlanFeatureCache,
  setCachedPlanFeatures,
} from "../plan-entitlement-cache"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { limitsForPlan } from "../../modules/vendor-plan/limits"

/**
 * The gate and the limit checks read the same snapshot through the same cache.
 * These cover that sharing explicitly — a second cache would mean the gate and
 * the limit could disagree about which plan a seller is on.
 */

type Opts = {
  planCode?: string
  planKeys?: string[]
  entitlementKeys?: string[]
  planThrows?: boolean
}

const makeReq = (opts: Opts = {}) => {
  const ensureAssignment = jest.fn(async () => {
    if (opts.planThrows) throw new Error("plan service down")
    return { plan_code: opts.planCode ?? "free" }
  })
  const getEntitledFeatureKeys = jest.fn(async () => opts.planKeys ?? [])
  const listActiveFeatureKeysForSeller = jest.fn(
    async () => opts.entitlementKeys ?? []
  )

  const req = {
    scope: {
      resolve: (key: string) => {
        if (key === VENDOR_PLAN_MODULE) {
          return { ensureAssignment, getEntitledFeatureKeys }
        }
        if (key === ENTITLEMENT_MODULE) {
          return { listActiveFeatureKeysForSeller }
        }
        return undefined
      },
    },
  }

  return { req, ensureAssignment, getEntitledFeatureKeys, listActiveFeatureKeysForSeller }
}

beforeEach(() => {
  clearPlanFeatureCache()
})

describe("getSellerPlanSnapshot", () => {
  it("unions plan features with directly held entitlements", async () => {
    const { req } = makeReq({
      planCode: "starter",
      planKeys: ["vendor.embed"],
      entitlementKeys: ["vendor.pos"],
    })

    const snapshot = await getSellerPlanSnapshot(req as never, "sel_1")
    expect(snapshot.plan_code).toBe("starter")
    expect([...snapshot.feature_keys].sort()).toEqual([
      "vendor.embed",
      "vendor.pos",
    ])
  })

  it("keeps the plan's features when the entitlement read fails", async () => {
    const { req } = makeReq({ planCode: "pro", planKeys: ["vendor.pos"] })
    ;(req.scope as { resolve: (k: string) => unknown }).resolve = (k: string) =>
      k === VENDOR_PLAN_MODULE
        ? {
            ensureAssignment: async () => ({ plan_code: "pro" }),
            getEntitledFeatureKeys: async () => ["vendor.pos"],
          }
        : (() => {
            throw new Error("entitlement module missing")
          })()

    const snapshot = await getSellerPlanSnapshot(req as never, "sel_1")
    expect([...snapshot.feature_keys]).toEqual(["vendor.pos"])
  })

  it("serves a cached snapshot without touching the plan service", async () => {
    const { req, ensureAssignment } = makeReq({ planCode: "pro" })
    setCachedPlanFeatures("sel_cached", {
      plan_code: "scale",
      feature_keys: new Set(["vendor.quests"]),
    })

    const snapshot = await getSellerPlanSnapshot(req as never, "sel_cached")
    expect(snapshot.plan_code).toBe("scale")
    expect(ensureAssignment).not.toHaveBeenCalled()
  })
})

describe("getSellerPlanLimits", () => {
  it("returns the limits of the seller's plan", async () => {
    const { req } = makeReq({ planCode: "pro" })
    const { plan_code, limits } = await getSellerPlanLimits(req as never, "sel_1")

    expect(plan_code).toBe("pro")
    expect(limits).toEqual(limitsForPlan("pro"))
  })

  it("shares the gate's cache, costing a gated request no extra read", async () => {
    const { req, ensureAssignment } = makeReq({ planCode: "free" })

    // First call populates the cache the gate would have populated.
    await getSellerPlanSnapshot(req as never, "sel_1")
    expect(ensureAssignment).toHaveBeenCalledTimes(1)

    const { plan_code } = await getSellerPlanLimits(req as never, "sel_1")
    expect(plan_code).toBe("free")
    expect(ensureAssignment).toHaveBeenCalledTimes(1)
  })

  it("degrades to the free tier instead of throwing", async () => {
    // A limit check sits on ordinary create paths. Turning a plan-service blip
    // into a 500 on POST /vendor/embed-keys would be worse than briefly
    // applying the most restrictive real ceiling.
    const { req } = makeReq({ planThrows: true })
    const { plan_code, limits } = await getSellerPlanLimits(req as never, "sel_1")

    expect(plan_code).toBe("free")
    expect(limits).toEqual(limitsForPlan("free"))
  })
})

describe("respondPlanLimitReached", () => {
  it("emits a 402 the panel can turn into an upsell", async () => {
    const res: Record<string, unknown> = {}
    res.status = (c: number) => {
      res.statusCode = c
      return res
    }
    res.json = (b: unknown) => {
      res.body = b
      return res
    }

    respondPlanLimitReached(res as never, {
      limit_key: "embed_keys",
      limit: 1,
      current: 1,
      plan_code: "free",
      noun: "embed keys",
    })

    expect(res.statusCode).toBe(402)
    const body = res.body as Record<string, unknown>
    // Distinct from the gate's `plan_upgrade_required`: "you have used all of
    // yours" and "your plan does not include this" need different copy.
    expect(body.code).toBe("plan_limit_reached")
    expect(body.type).toBe("plan_limit_reached")
    expect(body.limit_key).toBe("embed_keys")
    expect(body.limit).toBe(1)
    expect(body.current).toBe(1)
    expect(body.current_plan).toBe("free")
    expect(body.upgrade_url).toBe("/settings/billing")
  })
})
