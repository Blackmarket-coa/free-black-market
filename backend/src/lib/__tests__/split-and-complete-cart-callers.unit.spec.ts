import fs from "fs"
import path from "path"

/**
 * SD-54 / SD-72 (a) tripwire: FBM's cart-completion guards reach Mercur's
 * `splitAndCompleteCartWorkflow` only through the middleware in front of its
 * route, `POST /store/carts/:id/complete`
 * (`api/middlewares/cart-completion-guards.ts`). The workflow has no hook that
 * runs before it authorizes the card, so a caller in `src/` that ran it
 * directly would complete carts with none of the guards.
 *
 * So no file under `src/` may name it in code: not its export
 * `splitAndCompleteCartWorkflow` (under any alias, or through a namespace
 * import), not its id `split-and-complete-cart` in any string (a run through
 * the workflow engine by id, or a require of its module path), and not FBM's
 * constant for that id, `SPLIT_AND_COMPLETE_CART_WORKFLOW_ID`, except in the
 * one file that defines it to read the run's execution row
 * (`api/middlewares/cart-completion-finished.ts`). Comments do not count.
 *
 * What this cannot see: Medusa's generic admin runner,
 * `POST /admin/workflows-executions/:workflow_id/run`, runs any registered
 * workflow by id with the caller's input, `split-and-complete-cart` included,
 * and no FBM middleware stops that one (an admin-only way past the guards,
 * recorded in docs/AUDIT_DEBT.md). It is a text check, not a proof.
 */

const SRC_DIR = path.resolve(__dirname, "..", "..")
const ALLOWED = new Set([path.join("api", "middlewares", "cart-completion-finished.ts")])

/** The source with comments blanked out; strings and template literals kept (as `cancel-order-workflow-callers.unit.spec.ts` does). */
function stripComments(src: string): string {
  let out = ""
  let i = 0
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code"
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line"
        i += 2
        continue
      }
      if (c === "/" && n === "*") {
        state = "block"
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === "`") state = c
      out += c
      i++
      continue
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code"
        out += c
      }
      i++
      continue
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code"
        i += 2
        out += " "
        continue
      }
      if (c === "\n") out += c
      i++
      continue
    }
    // inside a string or template literal
    if (c === "\\") {
      out += c + (n ?? "")
      i += 2
      continue
    }
    if (c === state) state = "code"
    out += c
    i++
  }
  return out
}

/** Every way this source names Mercur's workflow in code. */
function workflowUses(source: string): string[] {
  const code = stripComments(source)
  const uses: string[] = []
  for (const m of code.matchAll(/(?<![\w$])(splitAndCompleteCartWorkflow|SPLIT_AND_COMPLETE_CART_WORKFLOW_ID)(?![\w$])/g)) uses.push(m[1])
  for (const _ of code.matchAll(/split-and-complete-cart/g)) uses.push("split-and-complete-cart")
  return uses
}

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      files.push(...sourceFiles(full))
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.(spec|test)\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(full)
    }
  }
  return files
}

describe("the detector", () => {
  it.each<[string, string, boolean]>([
    // [label, source, names the workflow in code]
    ["a direct run", `import { splitAndCompleteCartWorkflow } from "@mercurjs/b2c-core/workflows"\nawait splitAndCompleteCartWorkflow(c).run({ input: { id } })`, true],
    ["an aliased run", `import { splitAndCompleteCartWorkflow as split } from "@mercurjs/b2c-core/workflows"\nawait split(c).run({})`, true],
    ["a namespace run", `import * as mercur from "@mercurjs/b2c-core/workflows"\nmercur.splitAndCompleteCartWorkflow(c).run({})`, true],
    ["a run by id through the engine", `await engine.run("split-and-complete-cart", { input })`, true],
    ["a require of its module path", "require(`@mercurjs/b2c-core/.medusa/server/src/workflows/cart/workflows/split-and-complete-cart`)", true],
    ["FBM's id constant", `import { SPLIT_AND_COMPLETE_CART_WORKFLOW_ID as ID } from "../api/middlewares/cart-completion-finished"`, true],
    ["mentions in comments only", `// splitAndCompleteCartWorkflow(c).run()\n/* "split-and-complete-cart" */\nexport {}`, false],
    ["another workflow", `await completeCartWorkflow(c).run({ input: { id } })`, false],
  ])("%s", (_label, source, names) => {
    expect(workflowUses(source).length > 0).toBe(names)
  })
})

describe("FBM's code and Mercur's split-and-complete-cart", () => {
  const scanned = sourceFiles(SRC_DIR).map((file) => ({
    file: path.relative(SRC_DIR, file),
    uses: workflowUses(fs.readFileSync(file, "utf8")),
  }))

  it("finds the one file allowed to name it, which reads the run's execution row (a walker that finds nothing proves nothing)", () => {
    const allowed = scanned.filter((s) => ALLOWED.has(s.file))
    expect(allowed.map((s) => s.file)).toEqual([...ALLOWED])
    expect(allowed[0].uses).toEqual(expect.arrayContaining(["SPLIT_AND_COMPLETE_CART_WORKFLOW_ID", "split-and-complete-cart"]))
    // Files that only mention it in comments are scanned and found clean.
    const commentOnly = scanned.find((s) => s.file === path.join("subscribers", "order-cycle-order-placed.ts"))
    expect(commentOnly).toBeDefined()
    expect(commentOnly?.uses).toEqual([])
  })

  it("no other file names it in code: the route is the only way FBM's code reaches it", () => {
    const naming = scanned.filter((s) => s.uses.length > 0 && !ALLOWED.has(s.file)).map((s) => ({ file: s.file, uses: s.uses }))
    expect(naming).toEqual([])
  })
})
