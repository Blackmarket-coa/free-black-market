import {
  DEFAULT_PLAN_CODE,
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
