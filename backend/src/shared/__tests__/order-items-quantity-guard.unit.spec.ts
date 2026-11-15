import { readdirSync, readFileSync, statSync } from "fs"
import { join, relative } from "path"

/**
 * SD-52: no order read may select `items.quantity`.
 *
 * Medusa 2.14.2 rewrites an order read's `items.quantity` to
 * `items.item.quantity` (`@medusajs/order/dist/utils/transform-order.js`), a
 * property OrderLineItem does not have, and the MikroORM this repository runs
 * then throws for every order that has a line item. Callers caught it, so for
 * months the cottage-food meter, the Blackout order events, wellness
 * registration and the seller order lists did nothing and no test failed.
 * Select `items.*` (or only the line fields needed) instead; the real-database
 * proof is integration-tests/http/order-items-quantity-read.spec.ts.
 *
 * Cart reads are fine: a cart line item has its own `quantity` column.
 *
 * The scan finds every object literal under src/ that contains
 * `entity: "order"` and fails if that literal also names `items.quantity`.
 * Field lists held in a separate constant are not seen.
 */

const SRC = join(__dirname, "..", "..")

/**
 * Order reads deliberately left selecting `items.quantity`, each with the
 * reason. An entry that no longer matches fails the last test, so fixing one
 * means removing it here.
 */
const OPERATOR_GATED: Record<string, string> = {
  // Its one live caller is subscribers/grower-karma-on-order-placed.ts: making
  // this read work starts awarding grower KARMA for sales, which
  // docs/F7_FLAT_PAYOUT_INVENTORY.md §10 item 8 reserves to the operator.
  "modules/agriculture/plant-order-helpers.ts": "SD-52 / F7 §10 item 8",
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(full))
    } else if (name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

/** The braces of the innermost object literal enclosing `pos`, skipping strings and comments. */
function enclosingObject(text: string, pos: number): [number, number] | null {
  // Map every brace outside a string or comment to its partner.
  const pairs = new Map<number, number>()
  const stack: number[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i)
      if (i < 0) break
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2)
      if (i < 0) break
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1
      i++
      continue
    }
    if (c === "{") stack.push(i)
    else if (c === "}") {
      const open = stack.pop()
      if (open !== undefined) pairs.set(open, i)
    }
    i++
  }
  let best: [number, number] | null = null
  for (const [open, close] of pairs) {
    if (open < pos && close > pos && (!best || open > best[0])) best = [open, close]
  }
  return best
}

/** Each order-read object literal in `text` that selects `items.quantity`, by line. */
function orderReadsSelectingItemsQuantity(text: string): number[] {
  const lines: number[] = []
  const entity = /entity:\s*["']order["']/g
  let m: RegExpExecArray | null
  while ((m = entity.exec(text))) {
    const span = enclosingObject(text, m.index)
    if (!span) continue
    const body = text.slice(span[0], span[1] + 1)
    if (/["']items\.quantity["']/.test(body)) {
      lines.push(text.slice(0, m.index).split("\n").length)
    }
  }
  return lines
}

describe("SD-52: order reads do not select items.quantity", () => {
  it("the scan finds an order read that does, and passes cart reads and items.*", () => {
    const bad = `await query.graph({\n  entity: "order",\n  fields: ["id", "items.quantity"],\n  filters: { id },\n})`
    const flippedOrder = `useQueryGraphStep({ fields: ["items.quantity"], entity: 'order' })`
    const cart = `await query.graph({ entity: "cart", fields: ["id", "items.quantity"] })`
    const good = `await query.graph({ entity: "order", fields: ["id", "items.*"] })`
    const nested = `query.graph({ entity: "order", fields: ["id"], filters: { id } }); const x = { a: "items.quantity" }`
    expect(orderReadsSelectingItemsQuantity(bad)).toEqual([2])
    expect(orderReadsSelectingItemsQuantity(flippedOrder)).toEqual([1])
    expect(orderReadsSelectingItemsQuantity(cart)).toEqual([])
    expect(orderReadsSelectingItemsQuantity(good)).toEqual([])
    expect(orderReadsSelectingItemsQuantity(nested)).toEqual([])
  })

  it("no order read under src/ selects items.quantity, apart from the operator-gated one", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/")
      if (OPERATOR_GATED[rel]) continue
      for (const line of orderReadsSelectingItemsQuantity(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("every operator-gated entry still selects items.quantity (remove it here once fixed)", () => {
    for (const rel of Object.keys(OPERATOR_GATED)) {
      const text = readFileSync(join(SRC, rel), "utf8")
      expect({ rel, lines: orderReadsSelectingItemsQuantity(text).length > 0 }).toEqual({ rel, lines: true })
    }
  })
})
