import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { CREATOR_ATTRIBUTION_MODULE } from "../../src/modules/creator-attribution"

jest.setTimeout(120 * 1000)

/**
 * Proves an order attribution can be persisted on a migrated database.
 *
 * `order_attribution` has three `model.bigNumber()` fields, whose generated
 * CRUD reads and writes a `raw_<field>` JSONB companion for each. The create
 * migration only ever made the NUMERIC half, so until
 * `Migration20260904AddRawBigNumberColumns` the module could not insert or
 * list a single row on a database built from its own migrations — the
 * attribution bridge was closed on paper and open in production.
 *
 * This boots the real app (which runs every migration, the fix included) and
 * does the one thing that failed: writes a row through the generated CRUD and
 * reads it back with the cents intact. No stub can stand in for the table.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    describe("creator-attribution bigNumber persistence", () => {
      it("writes and reads an order attribution through the generated CRUD", async () => {
        const service = getContainer().resolve(CREATOR_ATTRIBUTION_MODULE) as any
        const orderId = `order_${Math.random().toString(36).slice(2)}`

        const created = await service.createOrderAttributions({
          order_id: orderId,
          creator_seller_id: "sel_creator",
          source: "link_click",
          attribution_decided_at: new Date(),
          attributed_subtotal_cents: 12_345,
          commission_basis_cents: 12_345,
          commission_amount_cents: 617,
        })
        const row = Array.isArray(created) ? created[0] : created
        expect(row.id).toBeDefined()

        const [read] = await service.listOrderAttributions({ order_id: orderId })
        expect(read).toBeDefined()
        expect(Number(read.attributed_subtotal_cents)).toBe(12_345)
        expect(Number(read.commission_amount_cents)).toBe(617)
      })
    })
  },
})
