import { MedusaService } from "@medusajs/framework/utils"
import OrderChannelAttribution, { OrderChannel } from "./models/order-channel"

class OrderChannelService extends MedusaService({
  OrderChannelAttribution,
}) {
  /**
   * Record an order's channel. Idempotent, first-write-wins: the row is
   * written once at `order.placed` and a duplicate event returns the
   * existing attribution unchanged.
   */
  async setChannelForOrder(args: {
    order_id: string
    channel: OrderChannel
    source?: string | null
    customer_id?: string | null
  }): Promise<any> {
    const [existing] = await this.listOrderChannelAttributions({
      order_id: args.order_id,
    })
    if (existing) {
      return existing
    }
    const [created] = await (this as any).createOrderChannelAttributions([
      {
        order_id: args.order_id,
        channel: args.channel,
        source: args.source ?? null,
        customer_id: args.customer_id ?? null,
      },
    ])
    return created
  }

  /** Map of order_id → channel for a set of orders. */
  async channelsForOrders(orderIds: string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) {
      return new Map()
    }
    const rows = await this.listOrderChannelAttributions({ order_id: orderIds })
    return new Map(
      rows.map((r: { order_id: string; channel: string }) => [r.order_id, r.channel])
    )
  }
}

export default OrderChannelService
