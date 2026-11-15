import { readdirSync, readFileSync, statSync } from "fs"
import { join, relative } from "path"
import { ORDER_READ_ITEM_FIELDS } from "../order-line-item-fields"

/**
 * SD-52: an order read may name only OrderLineItem's own fields as
 * `items.<field>`.
 *
 * Medusa 2.14.2 rewrites every `items.<field>` on an order read to
 * `items.item.<field>` (`@medusajs/order/dist/utils/transform-order.js`), and
 * the read throws for any order with a line when OrderLineItem has no such
 * field. `items.quantity` did that on every order for the cottage-food meter,
 * the Blackout order events, wellness registration and the seller order lists,
 * and `items.total` does it to buyer dispute intake; every caller caught it,
 * so no test failed. Select `items.*` (it carries the quantity) or only the
 * line's own columns. The allowed set and why is `shared/order-line-item-fields.ts`;
 * the real-database proof is integration-tests/http/order-items-quantity-read.spec.ts.
 *
 * Cart reads are fine: a cart line item has its own `quantity` and totals.
 *
 * The scan finds every object literal under src/ that contains
 * `entity: "order"` and fails if that literal names a single-segment
 * `"items.<field>"` string whose field is not in that set. NOT seen: field
 * lists held in a separate constant, `remoteQueryObjectFromString` /
 * `entryPoint` reads, and deeper paths (`items.product.seller_id`), which
 * leave the order module and are not rewritten this way.
 */

const SRC = join(__dirname, "..", "..")

/**
 * Order reads knowingly left naming a field OrderLineItem lacks, each with the
 * reason. An entry that no longer matches fails the last test, so fixing one
 * means removing it here.
 */
const KNOWN_BROKEN: Record<string, string> = {
  // `items.quantity`. Its one live caller is
  // subscribers/grower-karma-on-order-placed.ts: making this read work starts
  // awarding grower KARMA for sales, which docs/F7_FLAT_PAYOUT_INVENTORY.md
  // §10 item 8 reserves to the operator.
  "modules/agriculture/plant-order-helpers.ts": "SD-52 / F7 §10 item 8 (operator-gated)",
  // `shared/order-dispute-intake.ts` used to be here (`items.total`, so no buyer
  // could open a dispute); the admin disputes work fixed its read, units and
  // seller path (SD-79), and this ratchet made the entry come out.
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

/**
 * Each order-read object literal in `text` that names an `items.<field>`
 * OrderLineItem does not have, as `line:field`.
 */
function orderReadsNamingNonLineFields(text: string): string[] {
  const out: string[] = []
  const entity = /entity:\s*["']order["']/g
  let m: RegExpExecArray | null
  while ((m = entity.exec(text))) {
    const span = enclosingObject(text, m.index)
    if (!span) continue
    const body = text.slice(span[0], span[1] + 1)
    const line = text.slice(0, m.index).split("\n").length
    for (const f of body.matchAll(/["']items\.([A-Za-z_*]+)["']/g)) {
      if (!ORDER_READ_ITEM_FIELDS.has(f[1])) out.push(`${line}:${f[1]}`)
    }
  }
  return out
}

describe("SD-52: order reads name only OrderLineItem fields under items.", () => {
  it("the scan flags quantities and totals on an order read, and passes cart reads, line columns and items.*", () => {
    const bad = `await query.graph({\n  entity: "order",\n  fields: ["id", "items.quantity"],\n  filters: { id },\n})`
    const flippedOrder = `useQueryGraphStep({ fields: ["items.quantity"], entity: 'order' })`
    const total = `query.graph({ entity: "order", fields: ["id", "items.total", "items.product.seller_id"] })`
    const cart = `await query.graph({ entity: "cart", fields: ["id", "items.quantity", "items.total"] })`
    const good = `await query.graph({ entity: "order", fields: ["id", "items.*", "items.unit_price", "items.metadata", "items.tax_lines.*"] })`
    const nested = `query.graph({ entity: "order", fields: ["id"], filters: { id } }); const x = { a: "items.quantity" }`
    expect(orderReadsNamingNonLineFields(bad)).toEqual(["2:quantity"])
    expect(orderReadsNamingNonLineFields(flippedOrder)).toEqual(["1:quantity"])
    expect(orderReadsNamingNonLineFields(total)).toEqual(["1:total"])
    expect(orderReadsNamingNonLineFields(cart)).toEqual([])
    expect(orderReadsNamingNonLineFields(good)).toEqual([])
    expect(orderReadsNamingNonLineFields(nested)).toEqual([])
  })

  it("no order read under src/ names a field OrderLineItem lacks, apart from the known-broken ones", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/")
      if (KNOWN_BROKEN[rel]) continue
      for (const hit of orderReadsNamingNonLineFields(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${hit}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("every known-broken entry still names one (remove it here once fixed)", () => {
    for (const rel of Object.keys(KNOWN_BROKEN)) {
      const text = readFileSync(join(SRC, rel), "utf8")
      expect({ rel, broken: orderReadsNamingNonLineFields(text).length > 0 }).toEqual({ rel, broken: true })
    }
  })
})
