import * as fs from "fs"
import * as path from "path"

import {
  CUSTOMER_DATA_REGISTRY,
  registryEntry,
} from "../customer-data-registry"

/**
 * The anti-drift guard for D11-1.
 *
 * The CCPA export and deletion endpoints each hand-listed the entities they
 * knew about, nothing told either of them when a module added another, and they
 * ended up covering two tables out of forty-seven — while the export told the
 * person it contained everything held about them.
 *
 * A longer hand-list would have drifted the same way. This test is the thing
 * that actually prevents it: add a `customer_id` to a model without deciding
 * what deletion does to it, and the build fails naming the table.
 */

const MODULES_DIR = path.join(__dirname, "..", "..", "modules")

/** Every entity in `src/modules/**` whose model declares a `customer_id`. */
function discoverCustomerLinkedEntities(): Array<{ entity: string; file: string }> {
  const found: Array<{ entity: string; file: string }> = []

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Migrations mirror the models and would double-count; specs are not
        // schema.
        if (entry.name === "__tests__" || entry.name === "migrations") continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith(".ts")) continue

      const src = fs.readFileSync(full, "utf8")
      if (!src.includes("customer_id")) continue

      // `model.define("table_name", { ... })`, possibly across lines.
      const defineRe = /model\s*\n?\s*\.?define\(\s*"([a-z0-9_]+)"/g
      let m: RegExpExecArray | null
      while ((m = defineRe.exec(src)) !== null) {
        const body = src.slice(m.index, m.index + 9000)
        if (/\bcustomer_id\s*:/.test(body)) {
          found.push({ entity: m[1], file: full })
        }
      }
    }
  }

  walk(MODULES_DIR)

  const seen = new Set<string>()
  return found.filter((f) => (seen.has(f.entity) ? false : (seen.add(f.entity), true)))
}

describe("customer data registry", () => {
  const discovered = discoverCustomerLinkedEntities()

  it("finds the customer-linked models at all", () => {
    // Guards the guard: a regex that silently matches nothing would make every
    // assertion below vacuously true.
    expect(discovered.length).toBeGreaterThan(30)
  })

  it("has an entry for every model that holds a customer_id", () => {
    const missing = discovered
      .filter((d) => !registryEntry(d.entity))
      .map((d) => `${d.entity}  (${path.relative(MODULES_DIR, d.file)})`)

    expect(missing).toEqual([])
  })

  it("has no entry for a model that no longer exists", () => {
    // The other direction: a stale entry means deletion tries to clear a table
    // that is gone, and the registry stops describing the system.
    const live = new Set(discovered.map((d) => d.entity))
    const stale = CUSTOMER_DATA_REGISTRY.filter((e) => !live.has(e.entity)).map(
      (e) => e.entity
    )

    expect(stale).toEqual([])
  })

  it("states a basis for everything it keeps", () => {
    // A retention with no stated basis is an omission, not a decision.
    const unjustified = CUSTOMER_DATA_REGISTRY.filter(
      (e) => e.action !== "delete" && !e.basis
    ).map((e) => e.entity)

    expect(unjustified).toEqual([])
  })

  it("names fields to clear wherever it says anonymise", () => {
    const empty = CUSTOMER_DATA_REGISTRY.filter(
      (e) => e.action === "retain" && e.anonymiseFields && e.anonymiseFields.length === 0
    ).map((e) => e.entity)

    expect(empty).toEqual([])
  })

  it("lists each entity once", () => {
    const counts = new Map<string, number>()
    for (const e of CUSTOMER_DATA_REGISTRY) {
      counts.set(e.entity, (counts.get(e.entity) ?? 0) + 1)
    }
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([])
  })

  it("keeps the food order's address out of a retained row", () => {
    // The concrete case that started this: a delivery kept the recipient's
    // name, phone and street address after they deleted their account.
    const order = registryEntry("food_order")
    expect(order?.action).toBe("retain")
    expect(order?.anonymiseFields).toEqual(
      expect.arrayContaining([
        "customer_name",
        "customer_phone",
        "delivery_address_line_1",
        "delivery_latitude",
      ])
    )
  })

  it("deletes wellness records rather than keeping them anonymised", () => {
    // An "anonymised" health record is still a health record about one person.
    for (const entity of [
      "wellness_member",
      "wellness_client_profile",
      "wellness_class_attendee",
    ]) {
      expect(registryEntry(entity)?.action).toBe("delete")
    }
  })
})
