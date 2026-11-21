import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import JurisdictionRulesModuleService from "../service"

/**
 * Jurisdiction rules are information only.
 *
 * That is an owner decision (docs/PLATES_SC_PILOT_PLAN.md, section 2: "never
 * blocks a sale"), not an implementation detail: FBM shows a seller what a
 * state's documents say and who checked the wording, and the seller remains
 * the authority on their own operation. A rule of kind `prohibition` is a
 * sentence for a person to read. These tests fail if someone later wires the
 * rule store into anything that can refuse an order, the way
 * `cottage-food/__tests__/non-blocking-contract.unit.spec.ts` guards that
 * module.
 */

const SRC = path.resolve(__dirname, "../../..")
const MODULE_DIR = path.resolve(__dirname, "..")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/")
const isTest = (file: string) => file.includes(`${path.sep}__tests__${path.sep}`)

/** Anything that reaches the module: its directory in an import, or its registration key. */
const NAMES_THE_MODULE = /modules\/jurisdiction-rules|JURISDICTION_RULES_MODULE|jurisdictionRulesModuleService/

describe("jurisdiction rules never block a sale", () => {
  const sources = walk(SRC).filter((file) => !isTest(file))

  it("is read only by its own admin routes, the Plates vendor routes and its seed", () => {
    const readers = sources
      .filter((file) => !file.startsWith(MODULE_DIR + path.sep))
      .filter((file) => NAMES_THE_MODULE.test(readFileSync(file, "utf8")))
      .map(rel)
      .sort()

    // The whole list, not a deny-list: a new reader has to be added here on
    // purpose, by someone who has decided it is not a place that can refuse
    // an order. Nothing under api/store, workflows, subscribers or jobs is on it.
    expect(readers).toEqual([
      "api/admin/jurisdiction-coverage/route.ts",
      "api/admin/jurisdiction-rules/[id]/review/route.ts",
      "api/admin/jurisdiction-rules/[id]/route.ts",
      "api/admin/jurisdiction-rules/[id]/withdraw/route.ts",
      "api/admin/jurisdiction-rules/route.ts",
      "api/admin/jurisdiction-rules/schema.ts",
      "api/admin/jurisdiction-sources/route.ts",
      "api/vendor/plates/_shared.ts",
      "api/vendor/plates/jurisdictions/[code]/route.ts",
      "api/vendor/plates/jurisdictions/route.ts",
      "scripts/seed-jurisdiction-rules.ts",
    ])
  })

  it("is not reached from anything on the cart, checkout or order path", () => {
    // Workflows and their hooks (cart validation lives there), subscribers,
    // jobs, the route middleware (the main checkout's guard seam) and the
    // store's cart routes. A later phase may show reviewed rule text on a
    // store page; it may not put it here.
    const onThePath = sources.filter((file) => {
      const name = rel(file)
      return (
        name.startsWith("workflows/") ||
        name.startsWith("subscribers/") ||
        name.startsWith("jobs/") ||
        name.startsWith("api/middlewares/") ||
        name === "api/middlewares.ts" ||
        name.startsWith("api/store/carts/")
      )
    })
    // Guards the guard: an empty walk would pass everything below, and so
    // would a walk that missed the files cart completion actually runs.
    expect(onThePath.length).toBeGreaterThan(100)
    expect(onThePath.map(rel)).toEqual(
      expect.arrayContaining([
        "workflows/hooks/complete-cart-validate.ts",
        "workflows/hooks/complete-cart-guards.ts",
        "api/middlewares/cart-completion-guards.ts",
      ])
    )

    const offenders = onThePath.filter((file) => NAMES_THE_MODULE.test(readFileSync(file, "utf8"))).map(rel)
    expect(offenders).toEqual([])
  })

  it("does not reference a cart or checkout workflow from inside the module", () => {
    const moduleSources = walk(MODULE_DIR).filter((file) => !isTest(file))
    expect(moduleSources.length).toBeGreaterThan(5)
    const offenders = moduleSources
      .filter((file) =>
        /completeCartWorkflow|createCartWorkflow|addToCartWorkflow|updateLineItemInCartWorkflow|hooks\.validate/.test(
          readFileSync(file, "utf8")
        )
      )
      .map(rel)
    expect(offenders).toEqual([])
  })

  it("exposes no method that returns a verdict about a seller, a product or a sale", () => {
    const methods = Object.getOwnPropertyNames(JurisdictionRulesModuleService.prototype)
    expect(methods).toEqual(expect.arrayContaining(["getRuleView", "createDraftVersion", "markReviewed", "withdrawRule"]))
    const verdictish = methods.filter((name) => /^(can|may|is|assert|validate|enforce|check|allow|permit)[A-Z]/.test(name))
    expect(verdictish).toEqual([])
  })

  it("answers nothing but 401 and 404 as a refusal on the seller-facing Plates routes", () => {
    const routes = walk(path.join(SRC, "api/vendor/plates")).filter((file) => !isTest(file))
    expect(routes.map(rel).sort()).toEqual([
      "api/vendor/plates/_shared.ts",
      "api/vendor/plates/jurisdictions/[code]/route.ts",
      "api/vendor/plates/jurisdictions/route.ts",
    ])
    for (const file of routes) {
      const src = readFileSync(file, "utf8")
      const statuses = [...src.matchAll(/\.status\(\s*(\d{3})\s*\)/g)].map((m) => Number(m[1]))
      for (const status of statuses) expect([401, 404]).toContain(status)
      expect(src).not.toMatch(/MedusaError/)
    }
  })
})
