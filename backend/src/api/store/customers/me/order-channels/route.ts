import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CHANNEL_MODULE } from "../../../../../modules/order-channel"
import type OrderChannelService from "../../../../../modules/order-channel/service"
import {
  summarizeOrdersByChannel,
  type ChannelSummaryOrder,
} from "../../../../../modules/order-channel/resolver"
import { OrderChannel } from "../../../../../modules/order-channel/models/order-channel"

/**
 * GET /store/customers/me/order-channels
 *
 * Unified cross-channel customer view (roadmap Phase 3A): the authenticated
 * customer's orders annotated with their originating channel (online / pos /
 * vending / pickup / subscription), plus a per-channel summary with counts
 * and per-currency totals. Orders placed before channel attribution existed
 * default to `online`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const query = req.scope.resolve("query") as any
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "total", "currency_code", "created_at"],
    filters: { customer_id: customerId },
  })

  const orderList = (orders ?? []) as Array<
    ChannelSummaryOrder & { display_id?: number; created_at?: string }
  >

  const channels = req.scope.resolve<OrderChannelService>(ORDER_CHANNEL_MODULE)
  const channelByOrderId = await channels.channelsForOrders(
    orderList.map((o) => o.id)
  )

  return res.status(200).json({
    summary: summarizeOrdersByChannel(orderList, channelByOrderId),
    orders: orderList.map((o) => ({
      id: o.id,
      display_id: o.display_id,
      total: o.total,
      currency_code: o.currency_code,
      created_at: o.created_at,
      channel: channelByOrderId.get(o.id) ?? OrderChannel.ONLINE,
    })),
  })
}
