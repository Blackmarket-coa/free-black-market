import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCTION_COSTING_MODULE } from "../../../../modules/production-costing"
import ProductionCostingModuleService from "../../../../modules/production-costing/service"
import { PRODUCTION_LEDGER_MODULE } from "../../../../modules/production-ledger"
import ProductionLedgerModuleService from "../../../../modules/production-ledger/service"
import { DELETE as deleteBatch } from "../../production-batches/[id]/route"
import { GET as listBatches, POST as createBatch } from "../../production-batches/route"
import { DELETE as deleteCost } from "../[id]/route"
import { GET as readRollup } from "../rollup/route"
import { GET as listCosts, POST as createCost } from "../route"

/**
 * The six production handlers, with the real `getSellerId`, the real costing
 * and ledger services, and in-memory rows.
 *
 * Two things are held here without a database; the HTTP spec
 * (`integration-tests/http/production-costing-every-plan.spec.ts`) holds both
 * on Postgres.
 *
 * 1. Every answer that carries a cost entry gives `quantity` and the two
 *    amounts as numbers. The in-memory read below returns `quantity` as a
 *    string, which is what a read of the NUMERIC column returns on a migrated
 *    database (measured there); a create returns what it was given.
 * 2. Rows are keyed by the store, not by the member who called. Behind the
 *    vendor gate the actor is a member id for every vendor (SD-145), so each
 *    request here carries a member actor and no `_seller_id`, and the store
 *    is found the way the routes find it: the member's row.
 */

type Row = Record<string, unknown> & { id: string; seller_id: string }

const STORE_A = "sel_bakery"
const STORE_B = "sel_other"
/** member id → the store it belongs to (the `member` table, as far as it is read). */
const MEMBERS: Record<string, string> = {
  mem_owner: STORE_A,
  mem_second: STORE_A,
  mem_rival: STORE_B,
}

const matches = (row: Row, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([k, v]) => row[k] === v)

function makeWorld() {
  const batches: Row[] = []
  const costs: Row[] = []

  const ledger = Object.create(ProductionLedgerModuleService.prototype) as Record<string, unknown>
  ledger.listProductionBatches = async (filter: Record<string, unknown> = {}) =>
    batches.filter((r) => matches(r, filter))
  ledger.createProductionBatches = async (data: Record<string, unknown>) => {
    const row = { id: `pb_${batches.length + 1}`, ...data } as Row
    batches.push(row)
    return row
  }
  ledger.retrieveProductionBatch = async (id: string) => {
    const row = batches.find((r) => r.id === id)
    if (!row) throw new Error(`ProductionBatch with id: ${id} was not found`)
    return row
  }
  ledger.deleteProductionBatches = async (id: string) => {
    batches.splice(batches.findIndex((r) => r.id === id), 1)
  }

  const costing = Object.create(ProductionCostingModuleService.prototype) as Record<string, unknown>
  /** A read of the migrated table: NUMERIC `quantity` comes back as a string. */
  const asRead = (row: Row) => ({ ...row, quantity: String(row.quantity) })
  costing.listProductionCostEntries = async (filter: Record<string, unknown> = {}) =>
    costs.filter((r) => matches(r, filter)).map(asRead)
  costing.createProductionCostEntries = async (data: Record<string, unknown>) => {
    const row = { id: `pce_${costs.length + 1}`, ...data } as Row
    costs.push(row)
    return row
  }
  costing.retrieveProductionCostEntry = async (id: string) => {
    const row = costs.find((r) => r.id === id)
    if (!row) throw new Error(`ProductionCostEntry with id: ${id} was not found`)
    return asRead(row)
  }
  costing.deleteProductionCostEntries = async (id: string) => {
    costs.splice(costs.findIndex((r) => r.id === id), 1)
  }

  const pg = {
    // `liveSellerIdOfMember`: the store of a live member of a live store.
    raw: async (_sql: string, [memberId]: string[]) => ({
      rows: MEMBERS[memberId] ? [{ seller_id: MEMBERS[memberId] }] : [],
    }),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === PRODUCTION_LEDGER_MODULE) return ledger
      if (key === PRODUCTION_COSTING_MODULE) return costing
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
      throw new Error(`unexpected resolve: ${key}`)
    },
  }

  /** Call a handler as a member, the way the vendor gate hands the request on. */
  const call = async (
    handler: (req: never, res: never) => Promise<unknown>,
    memberId: string | null,
    input: { body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {}
  ) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown as Record<string, any>,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(body: Record<string, any>) {
        this.body = body
        return this
      },
    }
    await handler(
      {
        scope,
        auth_context: memberId ? { actor_id: memberId, auth_identity_id: `authid_${memberId}` } : undefined,
        body: input.body,
        query: input.query ?? {},
        params: input.params ?? {},
      } as never,
      res as never
    )
    return { status: res.statusCode, body: res.body }
  }

  return {
    call,
    batches,
    costs,
    costing: costing as unknown as ProductionCostingModuleService,
  }
}

const typesOf = (entry: Record<string, unknown>) => ({
  quantity: typeof entry.quantity,
  unit_amount_cents: typeof entry.unit_amount_cents,
  amount_cents: typeof entry.amount_cents,
})
const ALL_NUMBERS = { quantity: "number", unit_amount_cents: "number", amount_cents: "number" }

/** A batch of store A's with one fractional cost line, both made by the owner. */
async function bakery() {
  const world = makeWorld()
  const batch = await world.call(createBatch, "mem_owner", {
    body: { item_label: "Sourdough", qty_started: 12, yield_qty: 10 },
  })
  const cost = await world.call(createCost, "mem_owner", {
    body: {
      production_batch_id: batch.body.production_batch.id,
      category: "material",
      label: "Rye flour, 25kg sack",
      quantity: 2.5,
      unit_amount_cents: 1250,
    },
  })
  return {
    ...world,
    batch,
    cost,
    batchId: batch.body.production_batch.id as string,
    costId: cost.body.production_cost_entry.id as string,
  }
}

describe("cost entries are answered with numbers", () => {
  it("POST /vendor/production-costs", async () => {
    const { cost } = await bakery()

    expect(cost.status).toBe(201)
    expect(typesOf(cost.body.production_cost_entry)).toEqual(ALL_NUMBERS)
    expect(cost.body.production_cost_entry).toMatchObject({
      quantity: 2.5,
      unit_amount_cents: 1250,
      amount_cents: 3125,
    })
  })

  it("GET /vendor/production-costs, whole list and one batch", async () => {
    const { call, batchId } = await bakery()

    const queries: Record<string, string>[] = [{}, { production_batch_id: batchId }]
    for (const query of queries) {
      const listed = await call(listCosts, "mem_owner", { query })
      expect(listed.status).toBe(200)
      expect(listed.body.count).toBe(1)
      const [entry] = listed.body.production_cost_entries
      // The stored read is a string; the answer is not.
      expect(typesOf(entry)).toEqual(ALL_NUMBERS)
      expect(entry).toMatchObject({ quantity: 2.5, unit_amount_cents: 1250, amount_cents: 3125 })
    }
  })

  it("the service's own read still returns the string, as the migrated table does", async () => {
    // Without this the two tests above could pass against a read that already
    // returned numbers, and prove nothing about the coercion.
    const { costing } = await bakery()
    const [row] = await costing.listForSeller(STORE_A)
    expect(typeof row.quantity).toBe("string")
    expect(row.quantity).toBe("2.5")
  })

  it("every production-costs route that answers a cost entry passes it through toCostEntryDTO", () => {
    // A new handler (an update, say) that answers the stored row would bring
    // the string back. Reads the route sources, so it sees one added later.
    const root = join(__dirname, "..")
    const routeFiles: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
          if (name !== "__tests__") walk(path)
        } else if (name === "route.ts") {
          routeFiles.push(path)
        }
      }
    }
    walk(root)
    expect(routeFiles.length).toBeGreaterThanOrEqual(3)

    const answering = routeFiles.filter((file) =>
      /production_cost_entr(y|ies)\b/.test(readFileSync(file, "utf8"))
    )
    // Today that is the list-and-create route, whose two answers the tests
    // above check. A second file here means a new answer to check.
    expect(answering.map((f) => f.slice(root.length))).toEqual(["/route.ts"])
    for (const file of answering) {
      expect(readFileSync(file, "utf8")).toContain("toCostEntryDTO(")
    }
  })

  it("the rollup is numbers too", async () => {
    const { call, batchId } = await bakery()
    const rollup = await call(readRollup, "mem_owner", {
      query: { production_batch_id: batchId, price_cents: "625" },
    })

    expect(rollup.status).toBe(200)
    expect(rollup.body.costing).toMatchObject({
      entry_count: 1,
      total_cents: 3125,
      cash_outlay_cents: 3125,
      in_kind_cents: 0,
      yield_qty: 10,
      unit_cost_cents: 313,
      margin_percent_at_price: ((625 - 313) / 625) * 100,
    })
  })
})

describe("production rows are keyed by the store, not by the member who called", () => {
  it("writes the batch and the cost line under the store", async () => {
    const { batch, cost, batches, costs } = await bakery()

    expect(batch.status).toBe(201)
    expect(batch.body.production_batch.seller_id).toBe(STORE_A)
    expect(cost.body.production_cost_entry.seller_id).toBe(STORE_A)
    expect(batches.map((r) => r.seller_id)).toEqual([STORE_A])
    expect(costs.map((r) => r.seller_id)).toEqual([STORE_A])
  })

  it("lets the store's second member read, cost and remove what the owner made", async () => {
    const { call, batchId, costId, costs } = await bakery()

    const batchesSeen = await call(listBatches, "mem_second")
    expect(batchesSeen.body.production_batches.map((b: Row) => b.id)).toEqual([batchId])
    const costsSeen = await call(listCosts, "mem_second")
    expect(costsSeen.body.production_cost_entries.map((c: Row) => c.id)).toEqual([costId])
    const rollup = await call(readRollup, "mem_second", { query: { production_batch_id: batchId } })
    expect(rollup.status).toBe(200)
    expect(rollup.body.costing.total_cents).toBe(3125)

    const added = await call(createCost, "mem_second", {
      body: { production_batch_id: batchId, category: "packaging", label: "Jars", amount_cents: 600 },
    })
    expect(added.status).toBe(201)
    expect(costs.map((r) => r.seller_id)).toEqual([STORE_A, STORE_A])

    expect((await call(deleteCost, "mem_second", { params: { id: costId } })).status).toBe(200)
    expect((await call(deleteBatch, "mem_second", { params: { id: batchId } })).status).toBe(200)
  })

  it("gives another store nothing, and 404 for anything of this store's by id", async () => {
    const { call, batchId, costId, batches, costs } = await bakery()

    expect((await call(listBatches, "mem_rival")).body).toEqual({ production_batches: [], count: 0 })
    expect((await call(listCosts, "mem_rival")).body).toEqual({ production_cost_entries: [], count: 0 })
    expect(
      (await call(listCosts, "mem_rival", { query: { production_batch_id: batchId } })).body.count
    ).toBe(0)
    expect((await call(readRollup, "mem_rival", { query: { production_batch_id: batchId } })).status).toBe(404)
    expect(
      (
        await call(createCost, "mem_rival", {
          body: { production_batch_id: batchId, category: "material", label: "x", amount_cents: 1 },
        })
      ).status
    ).toBe(404)
    expect((await call(deleteCost, "mem_rival", { params: { id: costId } })).status).toBe(404)
    expect((await call(deleteBatch, "mem_rival", { params: { id: batchId } })).status).toBe(404)
    expect([batches.length, costs.length]).toEqual([1, 1])
  })

  it("answers 401 to a request with no actor, and to a member of no live store", async () => {
    const { call, batchId, costId } = await bakery()

    for (const who of [null, "mem_removed"]) {
      const answers = [
        await call(listBatches, who),
        await call(createBatch, who, { body: { item_label: "x" } }),
        await call(deleteBatch, who, { params: { id: batchId } }),
        await call(listCosts, who),
        await call(createCost, who, {
          body: { production_batch_id: batchId, category: "material", label: "x", amount_cents: 1 },
        }),
        await call(readRollup, who, { query: { production_batch_id: batchId } }),
        await call(deleteCost, who, { params: { id: costId } }),
      ]
      expect(answers.map((a) => a.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
    }
  })
})
