import fs from "fs"
import path from "path"

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { refuseGuardedCartCompletion } from "../../../api/middlewares/cart-completion-guards"
import { CCR_RESERVATION_METADATA_KEY } from "../../../lib/ccr-checkout"
import { MAIN_CHECKOUT_GUARDS } from "../../../workflows/hooks/complete-cart-guards"
import { validateCcrReservation } from "../../../workflows/hooks/validate-ccr-reservation"

/**
 * Posture A and a refused cart completion (SD-53).
 *
 * A cart completion Medusa's workflow engine leaves unfinished is refused on
 * every FBM path (`lib/cart-completion.ts`, `workflows/steps/
 * require-completed-cart-order.ts`, `api/middlewares/cart-completion-finished.ts`).
 * Coalition Credits must not move on such a completion — not captured, not
 * credited, not spent. Today they cannot, for two reasons this spec pins so
 * that whoever changes either has to come here:
 *
 *   1. CCR has no completion path. `POST /store/carts/:id/credits` reserves
 *      credits into the cart escrow (`reference_type: CART`) and releases
 *      them; the leg that would spend them on the order,
 *      `settleCartCredits` (a BURN against the order), has no caller in
 *      `src/`, and a cart that still carries a reservation is refused before
 *      any order exists (`workflows/hooks/validate-ccr-reservation.ts`, which
 *      reads the count in the cart's metadata: a store client can overwrite
 *      it, and a count that is not a positive number reads as none) at
 *      both seams that complete carts: `completeCartWorkflow`'s validate
 *      hook, and, in front of Mercur's main checkout
 *      (`POST /store/carts/:id/complete`, whose workflow never calls that
 *      hook), `api/middlewares/cart-completion-guards.ts`. Neither checks
 *      a cart that has already completed
 *      (`workflows/hooks/complete-cart-guards.ts`): that cart's sale has
 *      already happened, and a refusal there would only fail the retry and
 *      run the refund compensation on a captured payment for an order that
 *      stands. So a stall cannot be followed by a BURN, and a cart with
 *      credits on it never reaches the stall through a store route. (Until
 *      SD-54 the guard read a field the hook never carries and refused
 *      nothing, and until SD-72 (a) was closed the main checkout ran no
 *      guard at all, so there a reserved cart completed at its full total
 *      with the credits left in escrow. No BURN followed either way, since
 *      `settleCartCredits` has no caller. Medusa's generic admin workflow
 *      runner can still run `split-and-complete-cart` past the middleware.)
 *   2. The refusals themselves touch no ledger: none of the four modules
 *      that refuse a completion imports the hawala ledger or the CCR
 *      libraries.
 *
 * Wiring `settleCartCredits` into a completion is the moment this spec fails,
 * deliberately: that caller must run after `requireCompletedCartOrderStep`
 * and never on a refused completion, and this spec is where that is written
 * down. See docs/POSTURE_A_COMPLIANCE.md and docs/AUDIT_DEBT.md SD-53.
 */

const SRC = path.resolve(__dirname, "../../..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, out)
    else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) out.push(abs)
  }
  return out
}

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8")
const rel = (abs: string) => path.relative(SRC, abs)

/** Every file under src/ that `start` reaches through relative imports, transitively. */
function importClosure(start: string): string[] {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const source = read(file)
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2]
      const base = path.join(path.dirname(path.join(SRC, file)), spec)
      const hit = [`${base}.ts`, path.join(base, "index.ts"), base].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      if (hit) visit(rel(hit))
    }
  }
  visit(start)
  return [...seen]
}

describe("Posture A: a refused cart completion cannot move Coalition Credits", () => {
  it("nothing in src/ spends a cart's reserved credits on an order: settleCartCredits has no caller", () => {
    const callers = walk(SRC)
      .filter((file) => /\bsettleCartCredits\s*\(/.test(fs.readFileSync(file, "utf8")))
      .map(rel)
      .sort()
    // Its own definition, and nothing else.
    expect(callers).toEqual(["lib/ccr-cart-ledger.ts"])
  })

  it("completeCartWorkflow refuses a cart that still carries a reservation, before any order exists", async () => {
    const hook = read("workflows/hooks/complete-cart-validate.ts")
    expect(hook).toContain("completeCartWorkflow.hooks.validate(")
    expect(hook).toContain("runCompleteCartGuards(")
    expect(read("workflows/hooks/complete-cart-guards.ts")).toContain("validateCcrReservation(")
    // SD-54: the source checks above stayed green while the guard read
    // `input.cart_id`, a field Medusa never passes, and refused nothing. So
    // the guard is also run here, with the argument Medusa 2.14.2 hands the
    // hook (`{ input: { id }, cart }`), on a cart holding a reservation.
    // integration-tests/http/complete-cart-validate-guards.spec.ts runs it
    // through the real workflow.
    // Query answers only under its real registration key, so a guard that
    // resolved a guessed key would read nothing and refuse nothing here.
    const container = {
      resolve: (key: string) => {
        if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unresolvable: ${key}`)
        return {
          graph: async ({ filters }: { filters: { id?: string } }) => ({
            data: filters.id === "cart_1" ? [{ id: "cart_1", metadata: { [CCR_RESERVATION_METADATA_KEY]: 1 } }] : [],
          }),
        }
      },
    }
    await expect(
      validateCcrReservation({ input: { id: "cart_1" }, cart: { id: "cart_1" } }, { container })
    ).rejects.toMatchObject({ type: "not_allowed" })
  })

  it("Mercur's main checkout refuses the same cart in front of its route, before any order exists (SD-72 (a))", async () => {
    // The registration: the guard middleware sits on the main checkout's own
    // matcher (its order among that route's middlewares is pinned in
    // api/__tests__/main-checkout-middleware-order.unit.spec.ts), and the
    // main checkout's guard list holds the CCR guard.
    expect(read("api/middlewares.ts")).toMatch(
      /matcher: "\/store\/carts\/:id\/complete",\s*method: "POST",\s*middlewares: \[refuseGuardedCartCompletion\]/
    )
    expect(MAIN_CHECKOUT_GUARDS.map((g) => g.name)).toContain("ccr-reservation")
    // And the middleware run with the real guards behind it, on a cart that
    // holds a reservation and has neither completed nor an order set. Query
    // answers only under its real registration key; nothing else resolves.
    const graph = async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
      if (entity === "order_set") return { data: [] }
      if (entity === "cart" && filters.id === "cart_1") {
        return { data: [{ id: "cart_1", completed_at: null, metadata: { [CCR_RESERVATION_METADATA_KEY]: 2 }, items: [] }] }
      }
      return { data: [] }
    }
    const scope = {
      resolve: (key: string) => {
        if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unresolvable: ${key}`)
        return { graph }
      },
    }
    const next = jest.fn()
    await expect(
      refuseGuardedCartCompletion(
        { params: { id: "cart_1" }, scope } as unknown as MedusaRequest,
        {} as MedusaResponse,
        next as unknown as MedusaNextFunction
      )
    ).rejects.toMatchObject({ type: "not_allowed" })
    expect(next).not.toHaveBeenCalled()
  })

  it("the guard middleware reaches no ledger through anything it imports, however deep", () => {
    const seen = importClosure("api/middlewares/cart-completion-guards.ts")
    // The walk reaches the guards and the CCR guard's own imports.
    expect(seen).toEqual(
      expect.arrayContaining([
        "workflows/hooks/complete-cart-guards.ts",
        "workflows/hooks/validate-ccr-reservation.ts",
        "lib/ccr-checkout.ts",
      ])
    )
    expect(seen.filter((file) => /hawala|ccr-cart-ledger|posture-a|card-clearing/.test(file))).toEqual([])
  })

  it.each([
    "lib/cart-completion.ts",
    "workflows/steps/require-completed-cart-order.ts",
    "api/middlewares/cart-completion-finished.ts",
    "api/middlewares/cart-completion-guards.ts",
  ])("%s imports no ledger: the refusal reads orders, links and executions only", (file) => {
    const source = read(file)
    const imports = [...source.matchAll(/^import[^;'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const spec of imports) {
      expect(spec).not.toMatch(/hawala|ccr-|posture-a|card-clearing/)
    }
    expect(source).not.toMatch(/HAWALA_LEDGER_MODULE|createTransfer|reserveCartCredits|releaseCartCredits|settleCartCredits/)
  })

  it("every FBM workflow that completes a cart runs the shared guard right after completeCartWorkflow", () => {
    const completers = walk(SRC)
      .filter((file) => /completeCartWorkflow\.runAsStep\(/.test(fs.readFileSync(file, "utf8")))
      .map(rel)
      .sort()
    expect(completers).toEqual([
      "workflows/complete-cart-with-tickets.ts",
      "workflows/create-digital-product-order/index.ts",
      "workflows/rental/create-rentals.ts",
      "workflows/subscription/workflows/create-subscription.ts",
      "workflows/subscription/workflows/renew-subscription.ts",
    ])
    for (const file of completers) {
      const source = read(file)
      const completion = source.indexOf("completeCartWorkflow.runAsStep(")
      const guard = source.indexOf("requireCompletedCartOrderStep(")
      expect([file, guard > completion]).toEqual([file, true])
      // Nothing else of the workflow between the two but the guard's comment.
      const between = source.slice(completion, guard)
      expect(between.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//") && !/^[\s})\],]*$/.test(line) && !/^\s*(input|id|key):/.test(line) && !/runAsStep\(\{|^\s*\}\)$/.test(line))).toEqual([])
    }
  })
})
