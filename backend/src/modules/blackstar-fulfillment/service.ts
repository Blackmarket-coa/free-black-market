import { MedusaService } from "@medusajs/framework/utils"
import { BlackstarShipment } from "./models"

export type RecordShipmentInput = {
  order_id: string
  fulfillment_id?: string | null
  fulfillment_node_id?: string | null
  pickup_point_id?: string | null
  vending_machine_id?: string | null
  external_status?: string | null
  metadata?: Record<string, unknown> | null
}

class BlackstarFulfillmentModuleService extends MedusaService({
  BlackstarShipment,
}) {
  async recordOrUpdateShipment(input: RecordShipmentInput) {
    const where: Record<string, unknown> = { order_id: input.order_id }
    if (input.fulfillment_id) where.fulfillment_id = input.fulfillment_id
    const [existing] = await this.listBlackstarShipments(where)
    if (existing) {
      const [updated] = await this.updateBlackstarShipments([
        {
          id: existing.id,
          fulfillment_id: input.fulfillment_id ?? existing.fulfillment_id,
          fulfillment_node_id: input.fulfillment_node_id ?? existing.fulfillment_node_id,
          pickup_point_id: input.pickup_point_id ?? existing.pickup_point_id,
          vending_machine_id: input.vending_machine_id ?? existing.vending_machine_id,
          external_status: input.external_status ?? existing.external_status,
          metadata: input.metadata ?? existing.metadata,
        },
      ])
      return updated
    }
    const [created] = await this.createBlackstarShipments([
      {
        order_id: input.order_id,
        fulfillment_id: input.fulfillment_id ?? null,
        fulfillment_node_id: input.fulfillment_node_id ?? null,
        pickup_point_id: input.pickup_point_id ?? null,
        vending_machine_id: input.vending_machine_id ?? null,
        external_status: input.external_status ?? null,
        metadata: input.metadata ?? null,
      },
    ])
    return created
  }
}

export default BlackstarFulfillmentModuleService
