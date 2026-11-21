import { readFileSync } from "fs"
import { join } from "path"
import {
  UNIVERSAL_FEATURE_KEYS,
  VENDOR_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  featureKeysForPlan,
} from "../../../modules/vendor-plan/catalog"

/**
 * Ties the gate registrations in `api/middlewares.ts` back to the plan catalog.
 *
 * The registrations are string literals in a 1200-line file, so nothing
 * otherwise connects them to the catalog: a renamed feature key would leave a
 * gate referencing a key no plan grants, which fails closed and locks every
 * vendor out of that route. This reads the real file rather than a fixture, so
 * it cannot drift from what is actually registered.
 */

const middlewaresSource = readFileSync(
  join(__dirname, "..", "..", "middlewares.ts"),
  "utf8"
)

/** Every feature key referenced by a `requirePlanFeature("…")` registration. */
function registeredFeatureKeys(): string[] {
  const keys = [...middlewaresSource.matchAll(/requirePlanFeature\(\s*"([^"]+)"/g)].map(
    (m) => m[1]
  )
  return [...new Set(keys)]
}

describe("plan gate coverage", () => {
  it("registers at least one gate", () => {
    // Guards against the regex silently matching nothing after a refactor,
    // which would make every assertion below vacuous.
    expect(registeredFeatureKeys().length).toBeGreaterThan(0)
  })

  it("only gates on keys the catalog defines", () => {
    // A gate on an unknown key fails closed for everyone, since no plan can
    // ever grant it.
    for (const key of registeredFeatureKeys()) {
      expect(VENDOR_FEATURE_KEYS).toContain(key)
    }
  })

  it("has at least one plan granting every gated key", () => {
    for (const key of registeredFeatureKeys()) {
      const granting = VENDOR_PLAN_CATALOG.filter((p) =>
        p.feature_keys.includes(key as never)
      )
      expect(granting.length).toBeGreaterThan(0)
    }
  })

  it("gates every feature key the catalog sells", () => {
    // A key that no plan gate references is being charged for but not enforced.
    const registered = new Set(registeredFeatureKeys())
    const unenforced = VENDOR_FEATURE_KEYS.filter((k) => !registered.has(k))
    expect(unenforced).toEqual([])
  })

  it("places each plan gate after its feature-flag gate", () => {
    // Order matters: the platform kill switch (404 — the feature does not
    // exist here) must be evaluated before the paywall (402 — it exists and
    // you may buy it). Reversed, a deployment with a module switched off would
    // still offer to sell it.
    const blocks = middlewaresSource.split(/\n\s*\{\s*\n/)
    for (const block of blocks) {
      if (!block.includes("requirePlanFeature(")) continue
      if (!block.includes("requireFeatureFlagMiddleware(")) continue
      expect(block.indexOf("requireFeatureFlagMiddleware(")).toBeLessThan(
        block.indexOf("requirePlanFeature(")
      )
    }
  })

  it("never gates a core commerce route", () => {
    // Products, orders, the seller profile, plan management itself and the
    // onboarding path must stay reachable on every plan — gating any of them
    // would lock a vendor out of the surface they'd use to fix their billing.
    const forbidden = [
      '"/vendor/products"',
      '"/vendor/orders"',
      '"/vendor/sellers/me"',
      '"/vendor/plan',
      '"/vendor/register"',
      '"/vendor/**"',
    ]
    const blocks = middlewaresSource.split(/\n\s*\{\s*\n/)
    for (const block of blocks) {
      if (!block.includes("requirePlanFeature(")) continue
      for (const matcher of forbidden) {
        expect(block).not.toContain(`matcher: ${matcher}`)
      }
    }
  })

  it("gives the free plan the universal keys and no other gated feature", () => {
    // A key a paid plan sells must never appear in `free`: its gate would pass
    // everyone and the plan difference would be invisible to whoever pays for
    // it. The universal keys are in `free` by definition, and they are all of
    // it.
    const freeKeys = featureKeysForPlan("free")
    expect([...freeKeys].sort()).toEqual([...UNIVERSAL_FEATURE_KEYS].sort())
  })

  it("keeps the kill switch and the plan gate on both production matchers", () => {
    // `vendor.production_ledger` is universal (PL-1), so its plan gate passes
    // every seller today. It stays registered on purpose: emptying
    // `UNIVERSAL_FEATURE_KEYS` then puts the paywall back with no route
    // change, and a failed plan lookup still answers 503 instead of opening
    // the route. The flag stays in front of it, so a deployment with the
    // module off answers 404.
    const blocks = middlewaresSource.split(/\n\s*\{\s*\n/)
    const gatesOf = (matcher: string) => {
      const found = blocks.filter((b) => b.includes(`matcher: "${matcher}"`))
      expect(found).toHaveLength(1)
      return found[0]
    }

    const batches = gatesOf("/vendor/production-batches*")
    expect(batches).toContain('requireFeatureFlagMiddleware("PRODUCTION_LEDGER_V1")')
    expect(batches).toContain('requirePlanFeature("vendor.production_ledger")')

    const costs = gatesOf("/vendor/production-costs*")
    expect(costs).toContain('requireFeatureFlagMiddleware("PRODUCTION_COSTING_V1")')
    expect(costs).toContain('requirePlanFeature("vendor.production_ledger")')

    for (const key of UNIVERSAL_FEATURE_KEYS) {
      expect(registeredFeatureKeys()).toContain(key)
    }
  })
})
