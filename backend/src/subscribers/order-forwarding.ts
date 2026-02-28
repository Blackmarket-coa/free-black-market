import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { SUPPLIER_FORWARDING_MODULE } from "../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../modules/supplier-forwarding/service"

export default async function orderForwardingSubscriber({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve("query") as any
  const supplierForwardingService = container.resolve(SUPPLIER_FORWARDING_MODULE) as SupplierForwardingModuleService

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: ["id", "email", "metadata", "items.*", "shipping_address.*"],
    filters: { id: data.id },
  })

  if (!order?.metadata?.supplier_id) {
    return
  }

  await supplierForwardingService.forwardOrder(order)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
