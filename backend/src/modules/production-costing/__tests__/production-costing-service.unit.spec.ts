import ProductionCostingService from "../service"
import { CostCategory, CostSource } from "../models/production-cost-entry"

/**
 * Service-level cover using the `Object.create(Service.prototype)` +
 * patched-CRUD pattern used elsewhere in the codebase (see
 * `payout-breakdown/__tests__/platform-fee-service.unit.spec.ts`). The
 * arithmetic itself is covered in `costing.unit.spec.ts`; what matters here is
 * that the service derives the right row and assembles the right rollup.
 */

type EntryRow = {
  seller_id: string
  production_batch_id: string
  category: string
  amount_cents: number
  is_cash_outlay: boolean
  currency_code?: string
}

const makeService = (rows: EntryRow[] = []) => {
  const svc = Object.create(ProductionCostingService.prototype) as Record<
    string,
    unknown
  >
  const created: Record<string, unknown>[] = []

  svc.listProductionCostEntries = (async (filter: Record<string, unknown> = {}) =>
    rows.filter((r) =>
      Object.entries(filter).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v
      )
    )) as unknown

  svc.createProductionCostEntries = (async (data: Record<string, unknown>) => {
    created.push(data)
    return { id: `pce_${created.length}`, ...data }
  }) as unknown

  return {
    service: svc as unknown as ProductionCostingService,
    created,
  }
}

describe("recordCost", () => {
  it("computes the amount from quantity x unit cost when not given", () => {
    const { service, created } = makeService()

    return service
      .recordCost({
        seller_id: "sel_1",
        production_batch_id: "pb_1",
        category: CostCategory.MATERIAL,
        label: "Organic rye, 25kg",
        quantity: 3,
        unit_amount_cents: 1250,
      })
      .then(() => {
        expect(created[0].amount_cents).toBe(3750)
      })
  })

  it("prefers an explicit amount over quantity x unit cost", async () => {
    const { service, created } = makeService()

    await service.recordCost({
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.MATERIAL,
      label: "Bulk discount applied",
      quantity: 3,
      unit_amount_cents: 1250,
      amount_cents: 3000,
    })

    expect(created[0].amount_cents).toBe(3000)
  })

  it("marks donated inputs as non-cash without being told", async () => {
    const { service, created } = makeService()

    await service.recordCost({
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.MATERIAL,
      label: "Donated flour",
      source: CostSource.DONATED,
      amount_cents: 2000,
    })

    expect(created[0].is_cash_outlay).toBe(false)
    expect(created[0].source).toBe(CostSource.DONATED)
  })

  it("defaults an unstated source to purchased and cash", async () => {
    const { service, created } = makeService()

    await service.recordCost({
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.PACKAGING,
      label: "Jars",
      amount_cents: 500,
    })

    expect(created[0].source).toBe(CostSource.PURCHASED)
    expect(created[0].is_cash_outlay).toBe(true)
  })
})

describe("getBatchCosting", () => {
  const rows: EntryRow[] = [
    {
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.MATERIAL,
      amount_cents: 3000,
      is_cash_outlay: true,
      currency_code: "usd",
    },
    {
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.LABOR,
      amount_cents: 1000,
      is_cash_outlay: false,
      currency_code: "usd",
    },
    // Another seller's batch — must never leak into the rollup.
    {
      seller_id: "sel_2",
      production_batch_id: "pb_1",
      category: CostCategory.MATERIAL,
      amount_cents: 9999,
      is_cash_outlay: true,
    },
  ]

  it("rolls up only the seller's own entries", async () => {
    const { service } = makeService(rows)
    const costing = await service.getBatchCosting("sel_1", "pb_1", 10)

    expect(costing.entry_count).toBe(2)
    expect(costing.total_cents).toBe(4000)
    expect(costing.cash_outlay_cents).toBe(3000)
    expect(costing.in_kind_cents).toBe(1000)
  })

  it("reports full and cash-only unit costs separately", async () => {
    const { service } = makeService(rows)
    const costing = await service.getBatchCosting("sel_1", "pb_1", 10)

    // $40.00 of real cost over 10 units, of which $30.00 was cash.
    expect(costing.unit_cost_cents).toBe(400)
    expect(costing.unit_cash_cost_cents).toBe(300)
  })

  it("suggests prices off the full unit cost, ascending by margin", async () => {
    const { service } = makeService(rows)
    const costing = await service.getBatchCosting("sel_1", "pb_1", 10)

    expect(costing.suggested_prices).toEqual([
      { margin_percent: 20, price_cents: 500 },
      { margin_percent: 30, price_cents: 572 },
      { margin_percent: 40, price_cents: 667 },
      { margin_percent: 50, price_cents: 800 },
    ])
  })

  it("returns null unit costs and no price suggestions before yield is known", async () => {
    const { service } = makeService(rows)
    const costing = await service.getBatchCosting("sel_1", "pb_1", null)

    expect(costing.total_cents).toBe(4000)
    expect(costing.unit_cost_cents).toBeNull()
    expect(costing.unit_cash_cost_cents).toBeNull()
    expect(costing.suggested_prices).toEqual([])
  })

  it("returns an empty rollup for a batch with no costs", async () => {
    const { service } = makeService(rows)
    const costing = await service.getBatchCosting("sel_1", "pb_unknown", 10)

    expect(costing.entry_count).toBe(0)
    expect(costing.total_cents).toBe(0)
    expect(costing.currency_code).toBe("usd")
  })
})

describe("getMarginAtPrice", () => {
  const rows: EntryRow[] = [
    {
      seller_id: "sel_1",
      production_batch_id: "pb_1",
      category: CostCategory.MATERIAL,
      amount_cents: 4000,
      is_cash_outlay: true,
    },
  ]

  it("reports the margin a price would realize", async () => {
    const { service } = makeService(rows)
    // $40.00 over 10 units = $4.00 unit cost; selling at $8.00 is 50%.
    await expect(service.getMarginAtPrice("sel_1", "pb_1", 10, 800)).resolves.toBe(50)
  })

  it("returns null when the batch has no yield to cost against", async () => {
    const { service } = makeService(rows)
    await expect(
      service.getMarginAtPrice("sel_1", "pb_1", null, 800)
    ).resolves.toBeNull()
  })
})
