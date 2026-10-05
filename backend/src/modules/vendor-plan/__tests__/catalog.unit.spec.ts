import {
  ALL_ACCESS_PLAN_CODE,
  DEFAULT_PLAN_CODE,
  PLANS_RETIRED_UNDER_ALL_ACCESS,
  PLATFORM_DEFAULT_FEE_PERCENT,
  VENDOR_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  featureKeysForPlan,
  getPlanDefinition,
  isPlanOffered,
  isVendorFeatureKey,
  offeredPlans,
  type VendorPlanDefinition,
} from "../catalog"
import { resolvePlatformFee } from "../../payout-breakdown/fee-resolution"

/**
 * The self-serve ladder depends on FF_ALL_ACCESS_PLAN_V1 (Black Mask F8).
 * Every ladder invariant below used to filter on the static `is_public` field;
 * it now runs over `offeredPlans(flag)` for BOTH flag states. Flag off, the
 * offered set is pinned to exactly the pre-F8 `is_public` set, so the flag-off
 * runs assert what the old ones did. A $10 0% plan could never coexist on one
 * ladder with the 2.5/2/1.5% tiers (0 < 2.5 breaks "falls monotonically" read
 * by price, and all keys ⊄ starter breaks "superset" in the other direction),
 * which is why the ladder is parameterised rather than loosened.
 */
const LADDERS: Array<[string, boolean, VendorPlanDefinition[]]> = [
  ["FF_ALL_ACCESS_PLAN_V1 off", false, offeredPlans(false)],
  ["FF_ALL_ACCESS_PLAN_V1 on", true, offeredPlans(true)],
]

describe("vendor plan catalog", () => {
  it("has unique plan codes", () => {
    const codes = VENDOR_PLAN_CATALOG.map((p) => p.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("includes the default plan, which must always exist", () => {
    // `getEntitledFeatureKeys` lazily assigns this to any seller without an
    // assignment, so its absence would make "on free" and "never provisioned"
    // indistinguishable.
    expect(getPlanDefinition(DEFAULT_PLAN_CODE)).not.toBeNull()
  })

  it("only references known feature keys", () => {
    for (const plan of VENDOR_PLAN_CATALOG) {
      for (const key of plan.feature_keys) {
        expect(VENDOR_FEATURE_KEYS).toContain(key)
      }
    }
  })

  it("has no duplicate feature keys within a plan", () => {
    for (const plan of VENDOR_PLAN_CATALOG) {
      expect(new Set(plan.feature_keys).size).toBe(plan.feature_keys.length)
    }
  })

  it("keeps the free plan free and featureless", () => {
    const free = getPlanDefinition(DEFAULT_PLAN_CODE)!
    expect(free.price_amount).toBe(0)
    expect(free.feature_keys).toEqual([])
  })

  describe.each(LADDERS)("offered ladder with %s", (_label, _on, offered) => {
    it("orders paid plans by increasing price", () => {
      const paid = offered
        .filter((p) => p.is_public && p.price_amount > 0)
        .sort((a, b) => a.display_order - b.display_order)
      for (let i = 1; i < paid.length; i++) {
        expect(paid[i].price_amount).toBeGreaterThan(paid[i - 1].price_amount)
      }
    })

    it("makes each public paid tier a superset of the one below", () => {
      // A vendor upgrading must never lose a feature.
      const ladder = offered
        .filter((p) => p.is_public)
        .sort((a, b) => a.display_order - b.display_order)
      for (let i = 1; i < ladder.length; i++) {
        const lower = new Set(ladder[i - 1].feature_keys)
        for (const key of lower) {
          expect(ladder[i].feature_keys).toContain(key)
        }
      }
    })
  })

  it("has an operator-assigned plan carrying every feature", () => {
    const internal = getPlanDefinition("internal")!
    expect(internal.is_public).toBe(false)
    expect(new Set(internal.feature_keys)).toEqual(new Set(VENDOR_FEATURE_KEYS))
  })

  it("fails closed for an unknown plan code", () => {
    expect(featureKeysForPlan("nope")).toEqual([])
    expect(featureKeysForPlan(null)).toEqual([])
    expect(featureKeysForPlan(undefined)).toEqual([])
  })

  it("recognises only vendor.* feature keys", () => {
    expect(isVendorFeatureKey("vendor.pos")).toBe(true)
    // The dashboard-extension namespace must not be usable as a billing key.
    expect(isVendorFeatureKey("hasProducts")).toBe(false)
    expect(isVendorFeatureKey("plugin:sales-analytics")).toBe(false)
    expect(isVendorFeatureKey(undefined)).toBe(false)
  })

  it("namespaces every feature key under vendor.", () => {
    for (const key of VENDOR_FEATURE_KEYS) {
      expect(key.startsWith("vendor.")).toBe(true)
    }
  })
})

describe("platform fee ladder", () => {
  /**
   * The ladder is a discount ladder: it may only ever lower a seller's take
   * rate. These are the invariants that make shipping it safe on a live
   * marketplace — break one and existing vendors start paying more than they
   * agreed to, silently, on their next order.
   */
  it("never charges more than the pre-plan platform default", () => {
    for (const plan of VENDOR_PLAN_CATALOG) {
      if (plan.platform_fee_percent === null) continue
      expect(plan.platform_fee_percent).toBeLessThanOrEqual(
        PLATFORM_DEFAULT_FEE_PERCENT
      )
    }
  })

  it("leaves the free tier exactly at the platform default", () => {
    // Introducing plans must not change what an existing vendor pays. Anything
    // above this is a price rise on every vendor who never opted into a plan.
    expect(getPlanDefinition("free")?.platform_fee_percent).toBe(
      PLATFORM_DEFAULT_FEE_PERCENT
    )
  })

  describe.each(LADDERS)("offered ladder with %s", (_label, _on, offered) => {
    const selfServe = offered
      .filter((p) => p.is_public)
      .sort((a, b) => a.display_order - b.display_order)

    it("falls monotonically as the plans get more expensive", () => {
      // A vendor's rate can only improve as they move up. A non-monotonic
      // ladder would mean an upgrade quietly raised someone's take rate.
      for (let i = 1; i < selfServe.length; i++) {
        const lower = selfServe[i - 1].platform_fee_percent
        const higher = selfServe[i].platform_fee_percent
        expect(lower).not.toBeNull()
        expect(higher).not.toBeNull()
        expect(higher as number).toBeLessThanOrEqual(lower as number)
      }
    })

    it("prices every self-serve plan", () => {
      // A null rate on a purchasable plan silently drops that tier to the
      // platform default, so the vendor pays for a discount they do not get.
      for (const plan of selfServe) {
        expect(plan.platform_fee_percent).not.toBeNull()
      }
    })

    it("starts the ladder at the free plan, at the platform default", () => {
      // The 3% default stays the entry point in both states: free vendors pay
      // exactly what they always have.
      expect(selfServe[0].code).toBe(DEFAULT_PLAN_CODE)
      expect(selfServe[0].platform_fee_percent).toBe(PLATFORM_DEFAULT_FEE_PERCENT)
    })

    it("never offers the operator plan", () => {
      expect(offered.map((p) => p.code)).not.toContain("internal")
    })
  })

  it("keeps every rate a sane percentage", () => {
    for (const plan of VENDOR_PLAN_CATALOG) {
      if (plan.platform_fee_percent === null) continue
      expect(plan.platform_fee_percent).toBeGreaterThanOrEqual(0)
      expect(plan.platform_fee_percent).toBeLessThanOrEqual(100)
    }
  })

  it("leaves the operator plan with no opinion", () => {
    // `internal` is FBM's own vendors; their fee is a paper transfer. Pinning a
    // number here would silently change internal revenue reporting.
    expect(getPlanDefinition("internal")?.platform_fee_percent).toBeNull()
  })
})

describe("offered set (FF_ALL_ACCESS_PLAN_V1)", () => {
  it("offers exactly the pre-F8 self-serve ladder with the flag off", () => {
    // The old assertions ran over `VENDOR_PLAN_CATALOG.filter(p => p.is_public)`
    // before all_access existed. Pin that the flag-off offered set IS that set,
    // in the same order, so the parameterised flag-off runs mean the same thing.
    expect(offeredPlans(false).map((p) => p.code)).toEqual([
      "free",
      "starter",
      "pro",
      "scale",
    ])
    expect(offeredPlans(false)).toEqual(
      VENDOR_PLAN_CATALOG.filter(
        (p) => p.is_public && p.code !== ALL_ACCESS_PLAN_CODE
      )
    )
  })

  it("offers exactly free and all_access with the flag on", () => {
    expect(offeredPlans(true).map((p) => p.code)).toEqual(["free", "all_access"])
  })

  it("keeps the retired tiers defined so existing assignments keep their features", () => {
    for (const code of PLANS_RETIRED_UNDER_ALL_ACCESS) {
      expect(getPlanDefinition(code)).not.toBeNull()
      expect(featureKeysForPlan(code).length).toBeGreaterThan(0)
      expect(isPlanOffered(code, true)).toBe(false)
      expect(isPlanOffered(code, false)).toBe(true)
    }
  })

  it("offers all_access only with the flag on, and internal never", () => {
    expect(isPlanOffered("all_access", true)).toBe(true)
    expect(isPlanOffered("all_access", false)).toBe(false)
    expect(isPlanOffered("internal", true)).toBe(false)
    expect(isPlanOffered("internal", false)).toBe(false)
    expect(isPlanOffered("nope", true)).toBe(false)
    expect(isPlanOffered(null, true)).toBe(false)
  })

  it("defines all_access as a $10/month, 0%, every-feature plan with a 30-day trial", () => {
    const plan = getPlanDefinition("all_access")!
    expect(plan).toMatchObject({
      code: "all_access",
      price_amount: 1000,
      currency_code: "usd",
      interval: "month",
      platform_fee_percent: 0,
      trial_days: 30,
      is_active: true,
      is_public: true,
    })
    expect(Number.isInteger(plan.price_amount)).toBe(true)
    expect(new Set(plan.feature_keys)).toEqual(new Set(VENDOR_FEATURE_KEYS))
  })

  it("resolves the all_access 0% as a plan rate, not the transaction-kind rule", () => {
    // The real resolver: a bought 0% is `source: plan` and still yields to a
    // negotiated override; the donation 0% is `source: transaction_kind`.
    const plan = getPlanDefinition("all_access")!.platform_fee_percent
    const sale = resolvePlatformFee({
      planPercent: plan,
      platformDefault: PLATFORM_DEFAULT_FEE_PERCENT,
    })
    expect(sale).toMatchObject({ percent: 0, source: "plan" })

    const donation = resolvePlatformFee({
      planPercent: plan,
      platformDefault: PLATFORM_DEFAULT_FEE_PERCENT,
      kind: "donation",
    })
    expect(donation.source).toBe("transaction_kind")

    const overridden = resolvePlatformFee({
      planPercent: plan,
      platformDefault: PLATFORM_DEFAULT_FEE_PERCENT,
      override: { custom_platform_fee_percent: 1.25 },
    })
    expect(overridden).toMatchObject({ percent: 1.25, source: "seller_override" })
  })
})
