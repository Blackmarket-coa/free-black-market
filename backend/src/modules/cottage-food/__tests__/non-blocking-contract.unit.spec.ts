import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import CottageFoodModuleService from "../service"

/**
 * The cottage-food module is informational by design: it counts a seller's
 * sales against limits the seller declared and shows them the number. It must
 * never prevent a sale.
 *
 * That is a product decision, not an implementation detail — a home producer
 * is the authority on their own compliance, and a platform that silently
 * refuses their orders at a threshold it inferred would be both wrong and
 * dangerous. These tests are the guard rail: they fail loudly if someone later
 * wires this module into checkout.
 */

const MODULE_DIR = join(__dirname, "..")
const API_DIR = join(__dirname, "../../../api")
const SUBSCRIBERS_DIR = join(__dirname, "../../../subscribers")
const CART_VALIDATE_HOOK = join(
  __dirname,
  "../../../workflows/hooks/complete-cart-validate.ts"
)
const ADD_TO_CART_HOOK = join(
  __dirname,
  "../../../workflows/hooks/add-to-cart-validation.ts"
)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full)
  }
  return out
}

describe("cottage-food never blocks a sale", () => {
  it("does not reference cart or checkout validation anywhere in the module", () => {
    const sources = walk(MODULE_DIR).filter((f) => !f.includes("__tests__"))
    expect(sources.length).toBeGreaterThan(0)

    const offenders = sources.filter((file) => {
      const src = readFileSync(file, "utf8")
      return (
        /completeCartWorkflow/.test(src) ||
        /addToCartWorkflow/.test(src) ||
        /hooks\.validate/.test(src)
      )
    })

    expect(offenders).toEqual([])
  })

  it("is not referenced by the cart-completion validator", () => {
    const src = readFileSync(CART_VALIDATE_HOOK, "utf8")
    expect(src).not.toMatch(/cottage/i)
  })

  it("is not referenced by the add-to-cart validator", () => {
    const src = readFileSync(ADD_TO_CART_HOOK, "utf8")
    expect(src).not.toMatch(/cottage/i)
  })

  it("never throws MedusaError from the module — advisories are prose, not faults", () => {
    const sources = walk(MODULE_DIR).filter((f) => !f.includes("__tests__"))
    const offenders = sources.filter((file) =>
      /throw new MedusaError/.test(readFileSync(file, "utf8"))
    )
    expect(offenders).toEqual([])
  })

  it("exposes no method that returns a pass/fail verdict", () => {
    const methods = Object.getOwnPropertyNames(
      CottageFoodModuleService.prototype
    )
    const verdictish = methods.filter((name) =>
      /^(can|may|is|assert|validate|enforce|check)[A-Z]/.test(name)
    )
    expect(verdictish).toEqual([])
  })

  it("keeps the order subscribers additive — no throw that could fail the order", () => {
    for (const name of [
      "cottage-food-record-sale.ts",
      "cottage-food-reverse-sale.ts",
    ]) {
      const src = readFileSync(join(SUBSCRIBERS_DIR, name), "utf8")
      // Every handler body is wrapped so a counting failure can never
      // propagate into order handling.
      expect(src).toMatch(/try\s*{/)
      expect(src).toMatch(/catch\s*\(/)
      expect(src).not.toMatch(/throw /)
    }
  })

  it("has no cottage-food route that rejects a request on a cap", () => {
    const routes = walk(API_DIR).filter((f) => f.includes("cottage-food"))
    expect(routes.length).toBeGreaterThan(0)

    for (const file of routes) {
      const src = readFileSync(file, "utf8")
      // 400s for malformed input are fine; a 402/403/409 keyed on a limit
      // would mean the surface had started gating something.
      expect(src).not.toMatch(/status\(40[239]\)/)
      expect(src).not.toMatch(/exceed/i)
    }
  })

  it("reports position past every declared limit without any blocking signal", async () => {
    // A seller far past all three of their own limits.
    const svc: any = Object.create(CottageFoodModuleService.prototype)
    svc.listCottageFoodProfiles = async () => [
      {
        id: "prof_1",
        seller_id: "sel_1",
        operation_type: "BOTH",
        cap_period_start_month: 1,
        timezone: "America/Los_Angeles",
        annual_sales_cap_cents: 1_000_00,
        daily_meal_cap: 5,
        weekly_meal_cap: 10,
        permit_expires_at: null,
        food_handler_expires_at: null,
      },
    ]
    svc.listCottageFoodSalesEntries = async () => [
      {
        seller_id: "sel_1",
        source: "medusa_order",
        occurred_at: "2026-06-12T18:00:00Z",
        amount_cents: 9_000_00,
        meal_count: 40,
        counts_toward_annual: true,
        counts_toward_meals: true,
      },
    ]

    const snapshot = await svc.getComplianceSnapshot(
      "sel_1",
      new Date("2026-06-12T19:00:00Z")
    )

    // Way over on every meter…
    expect(snapshot.annual.pct).toBeGreaterThan(100)
    expect(snapshot.today.pct).toBeGreaterThan(100)
    expect(snapshot.this_week.pct).toBeGreaterThan(100)

    // …and still nothing a caller could branch on to refuse a sale.
    expect(snapshot).not.toHaveProperty("blocked")
    expect(snapshot).not.toHaveProperty("allowed")
    expect(snapshot).not.toHaveProperty("can_sell")
    expect(snapshot).not.toHaveProperty("status")
    expect(Array.isArray(snapshot.advisories)).toBe(true)
    expect(
      snapshot.advisories.every((a: unknown) => typeof a === "string")
    ).toBe(true)
  })
})
