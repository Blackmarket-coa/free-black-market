import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/order-placed")
﻿import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { TICKET_BOOKING_MODULE } from "../modules/ticket-booking"
import TicketBookingModuleService from "../modules/ticket-booking/service"

export default async function handleOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
  const query = container.resolve("query")
  const notificationModuleService = container.resolve("notification") as any
  const ticketBookingModuleService = container.resolve(
    TICKET_BOOKING_MODULE
  ) as TicketBookingModuleService

  const { data: [order] } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "created_at",
      "items.*",
      "ticket_purchases.*",
      "ticket_purchases.ticket_product.*",
      "ticket_purchases.ticket_product.product.*",
      "ticket_purchases.ticket_product.venue.*",
      "ticket_purchases.venue_row.*",
      "customer.*",
      "billing_address.*",
    ],
    filters: {
      id: data.id,
    },
  })

  const ticketPurchaseIds: string[] = order.ticket_purchases?.
    map((purchase: any) => purchase?.id).filter(Boolean) as string[] || []

  const qrCodes = await ticketBookingModuleService.generateTicketQRCodes(ticketPurchaseIds)

  const firstTicketPurchase = order.ticket_purchases?.[0]

  await notificationModuleService.createNotifications({
    to: order.email || "",
    channel: "feed",
    template: "order.placed",
    data: {
      customer: {
        first_name: order.customer?.first_name || order.billing_address?.first_name,
        last_name: order.customer?.last_name || order.billing_address?.last_name,
      },
      order: {
        display_id: order.id,
        created_at: order.created_at,
        email: order.email,
      },
      show: {
        name: firstTicketPurchase?.ticket_product?.product?.title || "Your Event",
        date: firstTicketPurchase?.show_date.toLocaleString(),
        venue: firstTicketPurchase?.ticket_product?.venue?.name || "Venue Name",
      },
      tickets: order.ticket_purchases?.map((purchase: any) => ({
        label: purchase?.venue_row.row_type.toUpperCase(),
        seat: purchase?.seat_number,
        row: purchase?.venue_row.row_number,
        qr: qrCodes[purchase?.id || ""] || "",
      })),
      billing_address: order.billing_address
    },
  })
  } catch (error) {
    log.error(`[order-placed] Failed to process order ${data.id}:`, error)
    // Don't throw - notification failure shouldn't break the order flow
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
