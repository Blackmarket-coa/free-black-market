import fs from "fs"
import path from "path"

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
 *      `src/`, and `completeCartWorkflow`'s validate hook refuses a cart that
 *      still carries a reservation before any order exists
 *      (`workflows/hooks/validate-ccr-reservation.ts`). So a stall cannot be
 *      followed by a BURN, and a cart with credits on it never reaches the
 *      stall at all.
 *   2. The refusal itself touches no ledger: none of the three modules
 *      imports the hawala ledger or the CCR libraries.
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

describe("Posture A: a refused cart completion cannot move Coalition Credits", () => {
  it("nothing in src/ spends a cart's reserved credits on an order: settleCartCredits has no caller", () => {
    const callers = walk(SRC)
      .filter((file) => /\bsettleCartCredits\s*\(/.test(fs.readFileSync(file, "utf8")))
      .map(rel)
      .sort()
    // Its own definition, and nothing else.
    expect(callers).toEqual(["lib/ccr-cart-ledger.ts"])
  })

  it("completeCartWorkflow refuses a cart that still carries a reservation, before any order exists", () => {
    const hook = read("workflows/hooks/complete-cart-validate.ts")
    expect(hook).toContain("completeCartWorkflow.hooks.validate(")
    expect(hook).toContain("validateCcrReservation(")
    const guard = read("workflows/hooks/validate-ccr-reservation.ts")
    expect(guard).toContain("CCR_RESERVATION_METADATA_KEY")
    expect(guard).toContain("MedusaError.Types.NOT_ALLOWED")
  })

  it.each([
    "lib/cart-completion.ts",
    "workflows/steps/require-completed-cart-order.ts",
    "api/middlewares/cart-completion-finished.ts",
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
