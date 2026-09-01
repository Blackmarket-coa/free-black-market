import { createLogger } from "./logger"
import { NATIVE_PUSH_MODULE } from "../modules/native-push"
import type NativePushModuleService from "../modules/native-push/service"

const log = createLogger("shared/native-push-seller")

/**
 * Shared seller-push helper for order subscribers.
 *
 * Resolving the seller from an order uses the MercurJS `seller_order` link
 * (defineLink(seller, order, isList)), traversed exactly the way the
 * plugin's own `notification-seller-new-order` subscriber does it —
 * `query.graph({ entity: "order", fields: ["seller.id", ...] })`. Do NOT
 * read `order.seller_id`: the Order entity has no such column, and the
 * handful of places in this repo that ask for it silently fall back.
 *
 * Every failure mode here is soft. Push must never fail the originating
 * order event, so callers get `null` (or a no-op) rather than a throw.
 */

export type OrderForSellerPush = {
  id: string
  display_id?: number | string | null
  total?: number | null
  currency_code?: string | null
  seller?: { id?: string | null; name?: string | null } | null
  items?: Array<{ quantity?: number | null }> | null
}

/** Resolve the native-push service, or null when the module is absent. */
export function resolveNativePush(
  container: { resolve: (key: string) => unknown }
): NativePushModuleService | null {
  try {
    return container.resolve(NATIVE_PUSH_MODULE) as NativePushModuleService
  } catch {
    return null
  }
}

/**
 * Load the order fields a seller push needs, including the linked seller.
 * Returns null when the order is gone or the query fails.
 */
export async function loadOrderForSellerPush(
  container: { resolve: (key: string) => unknown },
  orderId: string
): Promise<OrderForSellerPush | null> {
  try {
    const query = container.resolve("query") as {
      graph: (args: unknown) => Promise<{ data: OrderForSellerPush[] }>
    }
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "total",
        "currency_code",
        "items.quantity",
        "seller.id",
        "seller.name",
      ],
      filters: { id: orderId },
    })
    return data?.[0] ?? null
  } catch (error) {
    log.error("failed to load order for seller push", error)
    return null
  }
}

/** Total units across an order's line items, for push copy. */
export function itemCount(order: OrderForSellerPush): number {
  return (order.items ?? []).reduce(
    (sum, item) => sum + (Number(item?.quantity) || 0),
    0
  )
}

/**
 * Send one notification to the seller behind an order. No-ops (and never
 * throws) when the module is missing, FCM is unconfigured, the order has
 * no linked seller, or the seller has no registered devices.
 */
export async function pushToOrderSeller(
  container: { resolve: (key: string) => unknown },
  orderId: string,
  build: (order: OrderForSellerPush) => {
    title: string
    body: string
    data?: Record<string, string>
  }
): Promise<void> {
  const nativePush = resolveNativePush(container)
  if (!nativePush || !nativePush.isSendingConfigured()) return

  try {
    const order = await loadOrderForSellerPush(container, orderId)
    const sellerId = order?.seller?.id
    if (!order || !sellerId) return

    const summary = await nativePush.sendToSeller(sellerId, build(order))

    if (summary.sent.length > 0 || summary.failed.length > 0) {
      log.info(
        `order ${order.id} -> seller ${sellerId}: push sent=${summary.sent.length} invalid=${summary.invalid.length} failed=${summary.failed.length}`
      )
    }
  } catch (error) {
    // Never fail the originating order event because a push failed.
    log.error("seller push failed", error)
  }
}
