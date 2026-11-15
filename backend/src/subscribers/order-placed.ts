import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/order-placed")
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"
import { EMAIL_TEMPLATES } from "../modules/resend/templates"
import type { OrderPlacedEmailOrder } from "../modules/resend/emails/order-placed"

/**
 * The buyer's order confirmation email.
 *
 * This used to send `channel: "feed", template: "order.placed"`. No provider
 * is registered for `feed` (medusa-config registers `seller_feed` and, when
 * configured, `email`), so every call failed inside this subscriber's catch
 * and nobody was ever emailed — while the storefront's confirmation page
 * told the buyer "We have sent the order confirmation details to <email>".
 * Nothing read the `feed` rows either: Mercur's `GET /admin/notifications`
 * lists that channel, but these were addressed to the buyer, not the admin.
 *
 * It now sends `order-placed` on the `email` channel, which both email
 * providers render (modules/resend/templates.ts). The ticket QR codes the old
 * payload built are gone with it: the `order-placed` template never rendered
 * them, and nothing else read them.
 */
/**
 * `items.*` and `shipping_methods.*`, not `items.total` & co. Checked against
 * a real order (integration-tests/http/order-confirmation-email.spec.ts):
 * selecting `items.total` or `shipping_methods.total` by name throws inside
 * MikroORM ("Cannot read properties of undefined (reading 'kind')"), and
 * asking for `total` beside a hand-picked `items.<field>` list that omits
 * `unit_price`/`quantity` returns an order total that silently leaves the
 * items out. With the wildcards the order module computes every total.
 */
export const ORDER_CONFIRMATION_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "total",
  "item_total",
  "tax_total",
  "items.*",
  "shipping_methods.*",
  "customer.first_name",
  "shipping_address.first_name",
]

type ConfirmationOrderRow = OrderPlacedEmailOrder & { email?: string | null }

/**
 * Totals come back from the order module as BigNumber instances. The template
 * formats numbers as currency and falls back to `toString()` for anything
 * else, which would print a bare "20" — so hand it plain numbers.
 */
function toAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

/**
 * Only what the template renders. The notification row stores `data`
 * verbatim, so passing the whole order would copy the buyer's addresses into
 * a table the customer-erasure registry does not cover.
 */
export function orderConfirmationPayload(order: ConfirmationOrderRow): { order: OrderPlacedEmailOrder } {
  return {
    order: {
      id: order.id,
      display_id: order.display_id ?? null,
      currency_code: order.currency_code,
      total: toAmount(order.total),
      item_total: toAmount(order.item_total),
      tax_total: toAmount(order.tax_total),
      items: (order.items ?? []).filter(Boolean).map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
        product_title: item.product_title ?? null,
        variant_title: item.variant_title ?? null,
        total: toAmount(item.total),
      })),
      shipping_methods: (order.shipping_methods ?? []).filter(Boolean).map((method) => ({
        id: method.id,
        name: method.name ?? null,
        total: toAmount(method.total),
      })),
      customer: { first_name: order.customer?.first_name ?? null },
      shipping_address: { first_name: order.shipping_address?.first_name ?? null },
    },
  }
}

export default async function handleOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const notificationModuleService = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION
    )

    const { data: rows } = await query.graph({
      entity: "order",
      fields: ORDER_CONFIRMATION_FIELDS,
      filters: { id: data.id },
    })
    const order = rows?.[0] as ConfirmationOrderRow | undefined

    if (!order) {
      log.warn(`[order-placed] Order ${data.id} not found; no confirmation sent`)
      return
    }
    if (!order.email) {
      log.warn(`[order-placed] Order ${data.id} has no email; no confirmation sent`)
      return
    }

    await notificationModuleService.createNotifications({
      to: order.email,
      channel: "email",
      template: EMAIL_TEMPLATES.ORDER_PLACED,
      data: orderConfirmationPayload(order),
      // A replayed order.placed must not email the buyer twice. Medusa skips a
      // key it has already sent and retries one whose last attempt failed.
      idempotency_key: `order-confirmation:${order.id}`,
    })
  } catch (error) {
    log.error(`[order-placed] Failed to send the order confirmation for ${data.id}:`, error)
    // Don't throw - notification failure shouldn't break the order flow
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
