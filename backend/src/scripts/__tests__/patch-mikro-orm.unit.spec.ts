import * as fs from "fs"
import * as path from "path"
import { EntitySchema, MikroORM } from "@medusajs/framework/mikro-orm/core"
import { PostgreSqlDriver } from "@medusajs/framework/mikro-orm/postgresql"

/**
 * `scripts/patch-mikro-orm.js` against the MikroORM that is installed (SD-117).
 *
 * The script edits files under node_modules and reports a pattern it cannot
 * find as a log line; `postinstall` runs it with `|| true`. So a MikroORM bump
 * that moves one of its anchors, or an install that skipped it, changes
 * nothing visible until a store route answers 500. This spec is where that
 * shows:
 *
 *  - every pattern still matches the installed files, and matches once;
 *  - the installed tree carries every patch (it fails on an unpatched tree:
 *    run `node scripts/patch-mikro-orm.js` in backend/);
 *  - the script gives the same file from a pristine tree, from one the first
 *    version of the script patched (which had five of the seven hunks), and
 *    from one it has already patched;
 *  - the patched `EntityManager.preparePopulate` itself, on a small schema
 *    with no database: a nested field the entity does not have is not made a
 *    populate hint, one it has still is.
 *
 * The buyer's path through the real routes on Postgres is
 * `integration-tests/http/store-cart-path.spec.ts`.
 */

type Patch = {
  marker: string
  target: string
  replacement: (marker: string, target: string) => string
}
type Target = { label: string; find: () => string[]; patches: Patch[] }
type Outcome = { marker: string; result: "applied" | "already" | "missing" }
type PatchScript = {
  TARGET_FILES: Target[]
  applyPatches: (content: string, patches: Patch[]) => { content: string; outcome: Outcome[] }
}

const SCRIPT = path.resolve(__dirname, "../../../scripts/patch-mikro-orm.js")
const { TARGET_FILES, applyPatches } = jest.requireActual(SCRIPT) as PatchScript

/** The five hunks the first version of the script applied (2026-06-15). */
const FIRST_VERSION = [
  "FBM-PATCHED-pruneToOneRelations",
  "FBM-PATCHED-getJoinedFilters",
  "FBM-PATCHED-getFieldsForJoinedLoad",
  "FBM-PATCHED-joinedWhere",
  "FBM-PATCHED-joinedOrderBy",
]
/** The two this fix adds; the second is the fix. */
const ADDED = ["FBM-PATCHED-pruneUnknownRelation", "FBM-PATCHED-mergeResolvablePopulate"]

const count = (text: string, part: string) => text.split(part).length - 1

/** The installed text with every hunk taken back out: the file as npm ships it. */
function unpatched(content: string, patches: Patch[]): string {
  let text = content
  for (const patch of patches) {
    text = text.split(patch.replacement(patch.marker, patch.target)).join(patch.target)
  }
  return text
}

const installed = TARGET_FILES.flatMap((target) =>
  target.find().map((file) => ({ target, file, content: fs.readFileSync(file, "utf8") }))
)

describe("scripts/patch-mikro-orm.js on the installed MikroORM", () => {
  it("finds the files it patches, and knows the seven hunks", () => {
    for (const target of TARGET_FILES) {
      expect({ label: target.label, files: target.find().length > 0 }).toEqual({ label: target.label, files: true })
    }
    const markers = TARGET_FILES.flatMap((t) => t.patches.map((p) => p.marker))
    expect([...markers].sort()).toEqual([...FIRST_VERSION, ...ADDED].sort())
  })

  it("every installed copy carries every patch, once (an unpatched tree fails here: run the script)", () => {
    const missing: string[] = []
    for (const { target, file, content } of installed) {
      for (const patch of target.patches) {
        const n = count(content, patch.marker)
        if (n !== 1) missing.push(`${patch.marker} x${n} in ${file}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("every pattern matches the file npm ships exactly once, so a MikroORM bump that moves one fails here", () => {
    const problems: string[] = []
    for (const { target, file, content } of installed) {
      const pristine = unpatched(content, target.patches)
      if (/FBM-PATCHED/.test(pristine)) problems.push(`a hunk in ${file} is not the one this script writes`)
      for (const patch of target.patches) {
        const n = count(pristine, patch.target)
        if (n !== 1) problems.push(`${patch.marker}: pattern found ${n} times in ${file}`)
      }
    }
    expect(problems).toEqual([])
  })

  it("gives the same file from a pristine tree, from one the first version patched, and from its own output", () => {
    for (const { target, content } of installed) {
      const pristine = unpatched(content, target.patches)

      const fresh = applyPatches(pristine, target.patches)
      expect(fresh.outcome.map((o) => o.result)).toEqual(target.patches.map(() => "applied"))
      expect(fresh.content).toBe(content)

      // A deployment (or a pnpm store) the first version already patched.
      const first = applyPatches(
        pristine,
        target.patches.filter((p) => FIRST_VERSION.includes(p.marker))
      ).content
      const upgraded = applyPatches(first, target.patches)
      expect(upgraded.outcome).toEqual(
        target.patches.map((p) => ({ marker: p.marker, result: FIRST_VERSION.includes(p.marker) ? "already" : "applied" }))
      )
      expect(upgraded.content).toBe(content)

      const again = applyPatches(content, target.patches)
      expect(again.outcome.map((o) => o.result)).toEqual(target.patches.map(() => "already"))
      expect(again.content).toBe(content)
    }
  })

  it("reports a pattern it cannot find and leaves the text alone", () => {
    const [target] = TARGET_FILES
    const { content, outcome } = applyPatches("module.exports = {}\n", target.patches)
    expect(content).toBe("module.exports = {}\n")
    expect(outcome.map((o) => o.result)).toEqual(target.patches.map(() => "missing"))
  })
})

/**
 * The shapes that matter from Medusa's cart module: a cart with a to-one
 * address and to-many lines, the lines with to-many tax lines. No database is
 * touched: `preparePopulate` plans from metadata alone.
 */
const Address = new EntitySchema({
  name: "Address",
  properties: {
    id: { type: "string", primary: true },
    city: { type: "string", nullable: true },
  },
})
const Cart = new EntitySchema({
  name: "Cart",
  properties: {
    id: { type: "string", primary: true },
    email: { type: "string", nullable: true },
    shipping_address: { kind: "1:1", entity: "Address", owner: true, nullable: true },
    items: { kind: "1:m", entity: "LineItem", mappedBy: "cart" },
  },
})
const LineItem = new EntitySchema({
  name: "LineItem",
  properties: {
    id: { type: "string", primary: true },
    quantity: { type: "number" },
    cart: { kind: "m:1", entity: "Cart" },
    tax_lines: { kind: "1:m", entity: "TaxLine", mappedBy: "item" },
  },
})
const TaxLine = new EntitySchema({
  name: "TaxLine",
  properties: {
    id: { type: "string", primary: true },
    rate: { type: "number" },
    item: { kind: "m:1", entity: "LineItem" },
  },
})

type PopulateNode = { field: string; children?: PopulateNode[] }
type Planner = {
  preparePopulate: (entity: string, options: { fields?: string[]; populate?: string[] }) => Promise<PopulateNode[]>
}

describe("the patched EntityManager.preparePopulate (SD-117)", () => {
  let orm: MikroORM
  beforeAll(() => {
    orm = MikroORM.initSync({
      driver: PostgreSqlDriver,
      dbName: "never-connected",
      entities: [Address, Cart, LineItem, TaxLine],
      debug: false,
    })
  })
  afterAll(async () => {
    await orm.close(true)
  })

  /** The populate plan as dotted paths. */
  async function plan(options: { fields?: string[]; populate?: string[] }): Promise<string[]> {
    const em = orm.em.fork() as unknown as Planner
    const walk = (nodes: PopulateNode[], prefix: string): string[] =>
      nodes.flatMap((node) => [`${prefix}${node.field}`, ...walk(node.children ?? [], `${prefix}${node.field}.`)])
    return walk(await em.preparePopulate("Cart", options), "").sort()
  }

  // What Medusa sends for a cart: an explicit populate for every relation,
  // and a field list that also names paths the entity does not have.
  const MEDUSA_POPULATE = ["items", "items.tax_lines", "shipping_address"]
  const MEDUSA_FIELDS = [
    "id",
    "email",
    "items.id",
    "items.quantity",
    "items.variant", // a link to another module
    "items.tax_lines.rate",
    "shipping_address.city",
    "shipping_address.region_code", // the cart's Address has no such column
  ]

  it("a nested field the entity does not have is not made a populate hint", async () => {
    const paths = await plan({ fields: MEDUSA_FIELDS, populate: MEDUSA_POPULATE })
    expect(paths).not.toContain("shipping_address.region_code")
    expect(paths).not.toContain("items.variant")
  })

  it("the relations asked for are still populated, and a nested field that resolves is still merged in", async () => {
    const paths = await plan({ fields: MEDUSA_FIELDS, populate: MEDUSA_POPULATE })
    expect(paths).toEqual(
      [
        "items",
        "items.id",
        "items.quantity",
        "items.tax_lines",
        "items.tax_lines.rate",
        "shipping_address",
        "shipping_address.city",
      ].sort()
    )
  })

  it("an unknown relation in an explicit populate is still refused by name, not by a TypeError", async () => {
    await expect(plan({ fields: ["id", "customer.id"], populate: ["items", "customer"] })).rejects.toThrow(
      "Entity 'Cart' does not have property 'customer'"
    )
    // The same path in `fields` alone is no populate hint and no crash.
    expect(await plan({ fields: ["id", "customer.id"], populate: ["items"] })).toEqual(["items"])
  })

  it("a find given fields and no populate is planned as MikroORM plans it: the hunk touches only the merge", async () => {
    const paths = await plan({ fields: ["id", "shipping_address.city", "shipping_address.region_code"] })
    expect(paths).toEqual(["id", "shipping_address", "shipping_address.city", "shipping_address.region_code"].sort())
  })
})
