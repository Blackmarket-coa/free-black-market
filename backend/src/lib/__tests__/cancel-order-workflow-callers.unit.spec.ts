import fs from "fs"
import path from "path"

/**
 * SD-36 (8) tripwire: every file under src/ that runs Medusa's
 * `cancelOrderWorkflow` must also run FBM's shared-payment guard
 * (`assertCancelLeavesSharedPaymentAlone`, or `findOrdersSharingPayment` with
 * its own refusal), because that workflow refunds or voids the order's whole
 * payment collection and a Mercur cart's collection is every seller's
 * (lib/shared-payment-cancel.ts). The guard is opt-in per caller; this makes
 * forgetting it fail here instead of in someone's bank account.
 *
 * "Runs" means any use of `cancelOrderWorkflow` or `cancelOrderWorkflowId`
 * (under any alias, or through a namespace import) other than subscribing to
 * one of its hooks, and any string literal naming `cancel-order` or its refund
 * half `refund-captured-payments-workflow` (a run through the workflow engine
 * by id). Comments do not count. It is a text check, not a proof: it cannot
 * see a guard that runs in a different file from the cancel.
 */

const SRC_DIR = path.resolve(__dirname, "..", "..")
const WORKFLOW_ID_LITERALS = ["cancel-order", "refund-captured-payments-workflow"]
const GUARD_CALL = /(?<![\w$])(assertCancelLeavesSharedPaymentAlone|findOrdersSharingPayment)\s*\(/

/** The source with comments blanked out; strings and template literals kept. */
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type CancelUse = { kind: "identifier" | "workflow-id"; text: string }

/** Every way this source runs Medusa's cancel (or its refund half); hook subscriptions excluded. */
function cancelUses(source: string): CancelUse[] {
  const code = stripComments(source)
  const names = new Set(["cancelOrderWorkflow", "cancelOrderWorkflowId"])
  for (const m of code.matchAll(/(?<![\w$])(cancelOrderWorkflow(?:Id)?)\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[2])
  // An import declaration names the workflow without running it.
  const body = code.replace(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, "")

  const uses: CancelUse[] = []
  for (const name of names) {
    for (const m of body.matchAll(new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`, "g"))) {
      const after = body.slice((m.index ?? 0) + name.length)
      if (/^\s*\.\s*hooks\s*\./.test(after)) continue
      uses.push({ kind: "identifier", text: name })
    }
  }
  for (const id of WORKFLOW_ID_LITERALS) {
    for (const q of ["'", '"', "`"]) {
      if (body.includes(`${q}${id}${q}`)) uses.push({ kind: "workflow-id", text: id })
    }
  }
  return uses
}

const isGuarded = (source: string) => GUARD_CALL.test(stripComments(source))

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
  const imp = `import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"\n`

  it.each<[string, string, boolean, boolean]>([
    // [label, source, runs the cancel, guarded]
    ["a hook subscription only", `${imp}cancelOrderWorkflow.hooks.orderCanceled(async () => {})`, false, false],
    ["a direct run", `${imp}await cancelOrderWorkflow(container).run({ input: { order_id } })`, true, false],
    [
      "a guarded run",
      `${imp}await assertCancelLeavesSharedPaymentAlone(container, id)\nawait cancelOrderWorkflow(container).run({ input: { order_id: id } })`,
      true,
      true,
    ],
    [
      "an aliased run",
      `import { cancelOrderWorkflow as cancel } from "@medusajs/medusa/core-flows"\nawait cancel(container).run({})`,
      true,
      false,
    ],
    ["a namespace run", `import * as flows from "@medusajs/medusa/core-flows"\nflows.cancelOrderWorkflow(c).run({})`, true, false],
    ["a sub-workflow", `${imp}cancelOrderWorkflow.runAsStep({ input })`, true, false],
    ["a run by id through the engine", `await engine.run("cancel-order", { input })`, true, false],
    ["the refund half by id", "await engine.run(`refund-captured-payments-workflow`, { input })", true, false],
    [
      "the id constant",
      `import { cancelOrderWorkflowId } from "@medusajs/medusa/core-flows"\nconst ids = new Set([cancelOrderWorkflowId])`,
      true,
      false,
    ],
    ["a mention in comments only", `// cancelOrderWorkflow(container).run()\n/* "cancel-order" */\nexport {}`, false, false],
    ["a guard named only in a comment", `${imp}// assertCancelLeavesSharedPaymentAlone(c, id)\ncancelOrderWorkflow(c).run({})`, true, false],
    ["a URL in a string is not a comment", `const u = "https://x/"; cancelOrderWorkflow(c).run({})`, true, false],
  ])("%s", (_label, source, runs, guarded) => {
    expect(cancelUses(source).length > 0).toBe(runs)
    expect(isGuarded(source)).toBe(guarded)
  })
})

describe("FBM's callers of Medusa's cancelOrderWorkflow", () => {
  const files = sourceFiles(SRC_DIR)
  const scanned = files.map((file) => {
    const source = fs.readFileSync(file, "utf8")
    return { file: path.relative(SRC_DIR, file), uses: cancelUses(source), guarded: isGuarded(source) }
  })

  it("finds the callers it is meant to watch (a walker that finds none proves nothing)", () => {
    const running = scanned.filter((s) => s.uses.length > 0).map((s) => s.file)
    expect(running).toEqual(
      expect.arrayContaining([
        path.join("workflows", "steps", "validate-ticket-order.ts"),
        path.join("workflows", "rental", "steps", "validate-rental.ts"),
        path.join("api", "middlewares", "shared-payment-order-cancel.ts"),
      ])
    )
    // Subscribes to orderCanceled only: names the workflow, runs nothing.
    const hook = scanned.find((s) => s.file === path.join("workflows", "rental", "hooks", "validate-order-cancel.ts"))
    expect(hook).toBeDefined()
    expect(hook?.uses).toEqual([])
  })

  it("every one of them runs the shared-payment guard", () => {
    const unguarded = scanned.filter((s) => s.uses.length > 0 && !s.guarded).map((s) => ({ file: s.file, uses: s.uses }))
    expect(unguarded).toEqual([])
  })
})
