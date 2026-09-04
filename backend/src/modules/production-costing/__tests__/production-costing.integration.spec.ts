import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { PRODUCTION_COSTING_MODULE } from ".."
import ProductionCostingModuleService from "../service"
import { ProductionCostEntry } from "../models"
import { CostCategory, CostSource } from "../models/production-cost-entry"

/**
 * Real-Postgres roundtrip for the costing module.
 *
 * The unit specs stub the generated CRUD, so they cannot show that a cost line
 * survives the trip through MikroORM — in particular that the two
 * `model.bigNumber()` fields come back as the integer cents that went in, and
 * that a rollup over persisted rows matches a rollup over the in-memory lines.
 * That is what this proves.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/production-costing/__tests__/production-costing.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it.
 */
moduleIntegrationTestRunner<ProductionCostingModuleService>({
  moduleName: PRODUCTION_COSTING_MODULE,
  resolve: "./src/modules/production-costing",
  moduleModels: [ProductionCostEntry],
  testSuite: ({ service }) => {
    const seller = () => `sel_${Math.random().toString(36).slice(2)}`

    describe("production-costing on a real database", () => {
      it("persists integer cents through bigNumber and reads them back", async () => {
        const sellerId = seller()

        await service.recordCost({
          seller_id: sellerId,
          production_batch_id: "pb_1",
          category: CostCategory.MATERIAL,
          label: "Organic rye, 25kg",
          quantity: 3,
          unit_amount_cents: 1250,
        })

        const [row] = await service.listForBatch(sellerId, "pb_1")
        expect(row).toBeDefined()
        // NUMERIC + raw_ companion, and the number that comes back is the one
        // that went in — not a string, not a float drift.
        expect(Number(row.amount_cents)).toBe(3750)
        expect(Number(row.unit_amount_cents)).toBe(1250)
        expect(row.is_cash_outlay).toBe(true)
      })

      it("keeps cash and in-kind apart across persisted rows", async () => {
        const sellerId = seller()

        await service.recordCost({
          seller_id: sellerId,
          production_batch_id: "pb_2",
          category: CostCategory.MATERIAL,
          label: "Flour, purchased",
          amount_cents: 3000,
        })
        await service.recordCost({
          seller_id: sellerId,
          production_batch_id: "pb_2",
          category: CostCategory.LABOR,
          label: "Volunteer hours",
          source: CostSource.DONATED,
          amount_cents: 1000,
        })

        const costing = await service.getBatchCosting(sellerId, "pb_2", 10)
        expect(costing.entry_count).toBe(2)
        expect(costing.total_cents).toBe(4000)
        expect(costing.cash_outlay_cents).toBe(3000)
        expect(costing.in_kind_cents).toBe(1000)
        expect(costing.unit_cost_cents).toBe(400)
        expect(costing.unit_cash_cost_cents).toBe(300)
        expect(costing.suggested_prices).toEqual([
          { margin_percent: 20, price_cents: 500 },
          { margin_percent: 30, price_cents: 572 },
          { margin_percent: 40, price_cents: 667 },
          { margin_percent: 50, price_cents: 800 },
        ])
      })

      it("scopes reads by seller so one vendor never sees another's costs", async () => {
        const a = seller()
        const b = seller()
        await service.recordCost({
          seller_id: a,
          production_batch_id: "pb_shared",
          category: CostCategory.OVERHEAD,
          label: "Kitchen hours",
          amount_cents: 9999,
        })

        const forB = await service.getBatchCosting(b, "pb_shared", 1)
        expect(forB.entry_count).toBe(0)
        expect(forB.total_cents).toBe(0)
      })
    })
  },
})
