import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  VENDOR_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  featureKeysForPlan,
  getPlanDefinition,
  isVendorFeatureKey,
} from "../catalog"

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

  it("orders paid plans by increasing price", () => {
    const paid = VENDOR_PLAN_CATALOG.filter(
      (p) => p.is_public && p.price_amount > 0
    ).sort((a, b) => a.display_order - b.display_order)
    for (let i = 1; i < paid.length; i++) {
      expect(paid[i].price_amount).toBeGreaterThan(paid[i - 1].price_amount)
    }
  })

  it("makes each public paid tier a superset of the one below", () => {
    // A vendor upgrading must never lose a feature.
    const ladder = VENDOR_PLAN_CATALOG.filter((p) => p.is_public).sort(
      (a, b) => a.display_order - b.display_order
    )
    for (let i = 1; i < ladder.length; i++) {
      const lower = new Set(ladder[i - 1].feature_keys)
      for (const key of lower) {
        expect(ladder[i].feature_keys).toContain(key)
      }
    }
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
  const selfServe = VENDOR_PLAN_CATALOG.filter((p) => p.is_public).sort(
    (a, b) => a.display_order - b.display_order
  )

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

  it("falls monotonically as the plans get more expensive", () => {
    // A vendor's rate can only improve as they move up. A non-monotonic ladder
    // would mean an upgrade quietly raised someone's take rate.
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
