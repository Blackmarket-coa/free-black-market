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
 *
 * The root totals are the ones the summary adds up (modules/resend/
 * order-summary.ts): subtotals before tax and discount, the pre-tax discount
 * (as `discount_total - discount_tax_total`, because `discount_subtotal` is
 * not one of the order module's selectable totals), tax, credit lines, total.
 * Every one of them is in the order module's `shouldIncludeTotals` list.
 */
export const ORDER_CONFIRMATION_FIELDS = [
  "id",
  "display_id",
  "email",
  "customer_id",
  "currency_code",
  "total",
  "item_subtotal",
  "tax_total",
  "discount_total",
  "discount_tax_total",
  "credit_line_total",
  "items.*",
  "shipping_methods.*",
  "customer.first_name",
  "shipping_address.first_name",
]

/** What `query.graph` returns for those fields; totals arrive as BigNumber. */
type ConfirmationOrderRow = {
  id: string
  display_id?: number | string | null
  email?: string | null
  customer_id?: string | null
  currency_code: string
  total?: unknown
  item_subtotal?: unknown
  tax_total?: unknown
  discount_total?: unknown
  discount_tax_total?: unknown
  credit_line_total?: unknown
  items?: Array<{
    id: string
    thumbnail?: string | null
    product_title?: string | null
    variant_title?: string | null
    quantity?: unknown
    subtotal?: unknown
  } | null> | null
  shipping_methods?: Array<{ id: string; name?: string | null; subtotal?: unknown } | null> | null
  customer?: { first_name?: string | null } | null
  shipping_address?: { first_name?: string | null } | null
}

/**
 * Totals come back from the order module as BigNumber instances. The template
 * formats numbers as currency, so hand it plain numbers.
 */
function toAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

/** The pre-tax discount: each line's `discount_total` is subtotal + tax part. */
function discountSubtotal(order: ConfirmationOrderRow): number | null {
  const total = toAmount(order.discount_total)
  if (total === null) return null
  return total - (toAmount(order.discount_tax_total) ?? 0)
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
      item_subtotal: toAmount(order.item_subtotal),
      discount_subtotal: discountSubtotal(order),
      tax_total: toAmount(order.tax_total),
      credit_line_total: toAmount(order.credit_line_total),
      items: (order.items ?? []).flatMap((item) =>
        item
          ? [{
              id: item.id,
              thumbnail: item.thumbnail ?? null,
              product_title: item.product_title ?? null,
              variant_title: item.variant_title ?? null,
              quantity: toAmount(item.quantity),
              subtotal: toAmount(item.subtotal),
            }]
          : []
      ),
      shipping_methods: (order.shipping_methods ?? []).flatMap((method) =>
        method ? [{ id: method.id, name: method.name ?? null, subtotal: toAmount(method.subtotal) }] : []
      ),
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
    const order = rows?.[0] as unknown as ConfirmationOrderRow | undefined

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
      // Ties the stored row (the buyer's address, first name and items) to
      // the customer, so the customer-data registry's `notification` entry
      // can export and erase it.
      receiver_id: order.customer_id ?? null,
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
