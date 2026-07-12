import { OrderChannel } from "./models/order-channel"

/**
 * Pure channel resolution + aggregation for order-channel attribution.
 * No I/O — the `attribute-channel-on-placed` subscriber and the unified
 * customer-view route do the querying and call these.
 */

const CHANNEL_VALUES = new Set<string>(Object.values(OrderChannel))

export type ResolvedChannel = {
  channel: OrderChannel
  /** How the channel was determined. */
  source: "stamp" | "subscription" | "default"
}

/**
 * Resolve an order's channel from its metadata:
 *   1. An explicit, valid `metadata.order_channel` stamp wins (set by
 *      `POST /store/carts/:id/channel` pre-completion, or at order-creation
 *      time by server-side flows). Invalid stamps are ignored rather than
 *      trusted — a typo must not mask a subscription order.
 *   2. Subscription provenance (`metadata.subscription_id` / `metadata.renewal`)
 *      → SUBSCRIPTION.
 *   3. Default → ONLINE (the storefront is the only unstamped path today).
 */
export function resolveOrderChannel(args: {
  metadata?: Record<string, unknown> | null
}): ResolvedChannel {
  const md = args.metadata ?? {}

  const stamp =
    typeof md.order_channel === "string" ? md.order_channel.trim().toLowerCase() : null
  if (stamp && CHANNEL_VALUES.has(stamp)) {
    return { channel: stamp as OrderChannel, source: "stamp" }
  }

  if (typeof md.subscription_id === "string" && md.subscription_id.length > 0) {
    return { channel: OrderChannel.SUBSCRIPTION, source: "subscription" }
  }
  if (md.renewal === true) {
    return { channel: OrderChannel.SUBSCRIPTION, source: "subscription" }
  }

  return { channel: OrderChannel.ONLINE, source: "default" }
}

/** Is a raw string a valid channel value? (Used by the cart-stamp route.) */
export function isValidChannel(value: unknown): value is OrderChannel {
  return typeof value === "string" && CHANNEL_VALUES.has(value.trim().toLowerCase())
}

export type ChannelSummaryOrder = {
  id: string
  total?: number | string | null
  currency_code?: string | null
}

export type ChannelSummary = Record<
  string,
  { count: number; totals: Record<string, number> }
>

/**
 * Group a customer's orders by channel. Orders with no attribution row
 * default to "online" (pre-feature legacy orders). Totals are kept per
 * currency — summing across currencies would be meaningless.
 */
export function summarizeOrdersByChannel(
  orders: ChannelSummaryOrder[],
  channelByOrderId: ReadonlyMap<string, string>
): ChannelSummary {
  const summary: ChannelSummary = {}
  for (const order of orders) {
    const channel = channelByOrderId.get(order.id) ?? OrderChannel.ONLINE
    const bucket = (summary[channel] ??= { count: 0, totals: {} })
    bucket.count += 1

    const total = Number(order.total)
    if (Number.isFinite(total) && total !== 0) {
      const currency = (order.currency_code || "usd").toLowerCase()
      bucket.totals[currency] = (bucket.totals[currency] ?? 0) + total
    }
  }
  return summary
}
