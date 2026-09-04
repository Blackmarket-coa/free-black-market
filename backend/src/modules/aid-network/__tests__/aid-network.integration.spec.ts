import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { AID_NETWORK_MODULE } from ".."
import AidNetworkModuleService from "../service"
import { IntakeReceipt, NetworkNode, NodeStock, NodeTransfer } from "../models"
import { IntakeSource } from "../models/intake-receipt"
import { StockSource, StockStatus } from "../models/node-stock"
import { TransferStatus } from "../models/node-transfer"

/**
 * Real-Postgres coverage for the aid network's write paths.
 *
 * Two things here cannot be shown with a stubbed repository: that an intake
 * produces stock the planner can actually find on the next read, and that
 * receiving a transfer moves quantity in both directions — draws the origin
 * lot down and creates a destination lot — as rows, not as return values.
 *
 * Requires a database — run with:
 *   TEST_TYPE=integration:modules yarn test:integration:modules \
 *     src/modules/aid-network/__tests__/aid-network.integration.spec.ts
 *
 * Intentionally NOT a *.unit.spec.ts so the DB-less unit suite skips it.
 */
moduleIntegrationTestRunner<AidNetworkModuleService>({
  moduleName: AID_NETWORK_MODULE,
  resolve: "./src/modules/aid-network",
  moduleModels: [NetworkNode, NodeStock, IntakeReceipt, NodeTransfer],
  testSuite: ({ service }) => {
    const unique = () => Math.random().toString(36).slice(2, 8)

    async function hub(
      sellerId: string,
      over: Record<string, unknown> = {}
    ): Promise<string> {
      const created = await (service as any).createNetworkNodes({
        seller_id: sellerId,
        name: `Hub ${unique()}`,
        slug: `hub-${unique()}`,
        ...over,
      })
      return (Array.isArray(created) ? created[0] : created).id as string
    }

    describe("aid-network on a real database", () => {
      it("turns an intake into stock the planner finds on the next read", async () => {
        const sellerId = `sel_${unique()}`
        const pantry = await hub(sellerId)
        const freeStore = await hub(sellerId)

        const { intake_receipt, node_stock } = await service.recordIntake({
          seller_id: sellerId,
          node_id: pantry,
          source: IntakeSource.RESCUE,
          donor_name: "Corner Market",
          estimated_value_cents: 12_500,
          valuation_basis: "USDA wholesale",
          lines: [
            { item_key: "produce.carrots", item_label: "Carrots", quantity: 40 },
          ],
        })

        const receipt = Array.isArray(intake_receipt) ? intake_receipt[0] : intake_receipt
        expect(Number(receipt.estimated_value_cents)).toBe(12_500)
        expect(node_stock).toHaveLength(1)
        expect(node_stock[0].source).toBe(StockSource.RESCUED)
        expect(node_stock[0].intake_receipt_id).toBe(receipt.id)

        // The stock is allocatable immediately, from persisted rows.
        const plan = await service.planAllocation(sellerId, [
          {
            demand_id: "d_1",
            node_id: freeStore,
            item_key: "produce.carrots",
            quantity: 25,
          },
        ])
        expect(plan.unmet).toEqual([])
        expect(plan.allocations).toHaveLength(1)
        expect(plan.allocations[0]).toMatchObject({
          from_node_id: pantry,
          to_node_id: freeStore,
          quantity: 25,
          is_local: false,
        })
        expect(plan.leftover[0].quantity).toBe(15)
      })

      it("receiving a transfer draws the origin down by what shipped and stocks the destination", async () => {
        const sellerId = `sel_${unique()}`
        const from = await hub(sellerId)
        const to = await hub(sellerId)

        const { node_stock } = await service.recordIntake({
          seller_id: sellerId,
          node_id: from,
          lines: [{ item_key: "dry.rice", item_label: "Rice", quantity: 50 }],
        })
        const sourceStockId = node_stock[0].id as string

        const created = await service.requestTransfer({
          seller_id: sellerId,
          from_node_id: from,
          to_node_id: to,
          item_key: "dry.rice",
          item_label: "Rice",
          requested_qty: 20,
          source_stock_id: sourceStockId,
        })
        const transferId = (Array.isArray(created) ? created[0] : created).id as string

        // 20 requested, only 18 arrive.
        await service.receiveTransfer(sellerId, transferId, 18)

        const origin = await (service as any).retrieveNodeStock(sourceStockId)
        expect(Number(origin.quantity)).toBe(30)

        const atDestination = await service.listStockForNode(sellerId, to)
        expect(atDestination).toHaveLength(1)
        expect(Number(atDestination[0].quantity)).toBe(18)
        expect(atDestination[0].source).toBe(StockSource.TRANSFERRED)
        expect(atDestination[0].status).toBe(StockStatus.AVAILABLE)

        const transfer = await (service as any).retrieveNodeTransfer(transferId)
        expect(transfer.status).toBe(TransferStatus.RECEIVED)
        expect(Number(transfer.received_qty)).toBe(18)
        expect(transfer.destination_stock_id).toBe(atDestination[0].id)

        // A second receive of the same transfer is refused as a row-state check.
        await expect(
          service.receiveTransfer(sellerId, transferId, 1)
        ).rejects.toThrow(/already been received/i)
      })

      it("refuses a cold transfer to a hub without cold storage, from persisted hub rows", async () => {
        const sellerId = `sel_${unique()}`
        const cold = await hub(sellerId, { has_cold_storage: true })
        const warm = await hub(sellerId, { has_cold_storage: false })

        await expect(
          service.requestTransfer({
            seller_id: sellerId,
            from_node_id: cold,
            to_node_id: warm,
            item_key: "dairy.milk",
            item_label: "Milk",
            requested_qty: 5,
            requires_cold: true,
          })
        ).rejects.toThrow(/cold storage/i)

        await expect(
          service.requestTransfer({
            seller_id: sellerId,
            from_node_id: warm,
            to_node_id: cold,
            item_key: "dairy.milk",
            item_label: "Milk",
            requested_qty: 5,
            requires_cold: true,
          })
        ).resolves.toBeDefined()
      })
    })
  },
})
