import { readFileSync } from "fs"
import { join } from "path"
import {
  addonsGranting,
  plansGranting,
  readGatedRoutes,
  tiersGranting,
} from "../audit-vendor-plan-coverage"
import { VENDOR_PLAN_CATALOG } from "../../modules/vendor-plan/catalog"

/**
 * The audit's parse is the part that can break silently. If it stops matching
 * how `middlewares.ts` registers gates, the report prints an empty table —
 * which reads as "nothing is gated" rather than "I could not tell", and is the
 * most misleading output this script could produce.
 */

const middlewaresSource = readFileSync(
  join(__dirname, "..", "..", "api", "middlewares.ts"),
  "utf8"
)

describe("readGatedRoutes", () => {
  it("finds the gates that are actually registered", () => {
    const routes = readGatedRoutes(middlewaresSource)
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(route.featureKey).toMatch(/^vendor\./)
      expect(route.matcher).not.toBe("(unknown matcher)")
    }
  })

  it("records whether a kill switch runs before the paywall", () => {
    const routes = readGatedRoutes(middlewaresSource)
    // Most gated prefixes carry a feature flag as well — if none did, the
    // `flagGated` column would be dead and worth removing rather than printing.
    expect(routes.some((r) => r.flagGated)).toBe(true)
  })

  it("reads one route per registration block", () => {
    const source = `
  {
    matcher: "/vendor/alpha*",
    middlewares: [authenticate("seller", "bearer"), requirePlanFeature("vendor.pos")],
  },
  {
    matcher: "/vendor/beta*",
    middlewares: [
      authenticate("seller", "bearer"),
      requireFeatureFlagMiddleware("BETA_V1"),
      requirePlanFeature("vendor.quests"),
    ],
  },
  {
    matcher: "/vendor/ungated*",
    middlewares: [authenticate("seller", "bearer")],
  },
`
    const routes = readGatedRoutes(source)
    expect(routes).toEqual([
      { matcher: "/vendor/alpha*", featureKey: "vendor.pos", flagGated: false },
      { matcher: "/vendor/beta*", featureKey: "vendor.quests", flagGated: true },
    ])
  })

  it("returns nothing rather than guessing when there are no gates", () => {
    expect(readGatedRoutes("const middlewares = []")).toEqual([])
  })
})

describe("grant lookups", () => {
  it("lists plans in catalog order, cheapest first", () => {
    const granting = plansGranting("vendor.embed")
    expect(granting.length).toBeGreaterThan(0)

    const order = VENDOR_PLAN_CATALOG.map((p) => p.code)
    const positions = granting.map((code) => order.indexOf(code))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it("reports the add-on and enterprise paths to the same key", () => {
    // A key can be reached three ways — plan, add-on, org tier. A report that
    // only knew about plans would call a route unreachable when it is not.
    expect(addonsGranting("vendor.quests").length).toBeGreaterThan(0)
    expect(tiersGranting("vendor.embed")).toContain("tier1_verified")
    expect(tiersGranting("vendor.embed")).not.toContain("tier0_public")
  })

  it("reports no grant for a key nothing sells", () => {
    expect(plansGranting("vendor.not_a_key")).toEqual([])
    expect(addonsGranting("vendor.not_a_key")).toEqual([])
    expect(tiersGranting("vendor.not_a_key")).toEqual([])
  })
})

describe("the audit against the real route table", () => {
  it("finds no unreachable gate", () => {
    // The condition the report exists to surface: a gate no plan, add-on or
    // tier grants is closed for everyone, and nobody can buy their way in.
    const unreachable = readGatedRoutes(middlewaresSource).filter(
      (r) =>
        !plansGranting(r.featureKey).length &&
        !addonsGranting(r.featureKey).length &&
        !tiersGranting(r.featureKey).length
    )
    expect(unreachable.map((r) => `${r.matcher} (${r.featureKey})`)).toEqual([])
  })
})
