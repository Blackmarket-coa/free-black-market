import { createLogger } from "../shared/logger"
const log = createLogger("lib/black-mask-provisioning")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import subscriptionOrderLink from "../links/subscription-order"
import {
  blackMaskPlanCode,
  blackMaskProvisioningConfig,
  buildBlackMaskPayload,
  isBlackMaskProvisioningEnabled,
  isBlackMaskVaultLine,
  sequenceFrom,
  type BlackMaskConfig,
  type BlackMaskCustomerLookup,
  type BlackMaskEvent,
  type BlackMaskStoredPayload,
} from "../modules/marketplace-webhooks/black-mask"

/**
 * Black Mask provisioning (F3): Medusa event -> outbox row.
 *
 * One entry point for every event the channel listens to. In order, it
 * returns without writing anything when:
 *   1. FF_BLACK_MASK_PROVISIONING_V1 is off (nothing is resolved at all);
 *   2. the channel config is incomplete;
 *   3. the subject is not a vault order / subscription (isBlackMaskVaultLine:
 *      the product's Mercur seller is BLACK_MASK_SELLER_ID and the product's
 *      own metadata names a plan);
 *   4. the order is a subscription RENEWAL order arriving on order.placed
 *      (completeCartWorkflow emits order.placed for every renewal cycle;
 *      `renewed` on the subscription subject covers it, and `placed` is the
 *      only event that carries the customer email);
 *   5. the record lacks the stable timestamp its sequence comes from (e.g. a
 *      legacy renewal with no order, a cancel with no canceled_at, a
 *      grace_started / read_only event with no occurred_at). The sequence is
 *      never taken from updated_at: that moves on any later write, so a
 *      redelivered Medusa event would compute a new event_id and a duplicate
 *      row.
 * Otherwise it enqueues through MarketplaceWebhooksService.emitBlackMask,
 * which dedupes on the (subject, event, sequence) key.
 *
 * Errors are the caller's to swallow (the subscriber logs them): an enqueue
 * failure must not break checkout. That makes a swallowed enqueue invisible
 * until a reconciliation sweep exists, which is an open item.
 */

export const BLACK_MASK_MEDUSA_EVENTS = [
  "order.placed",
  "order.canceled",
  "subscription.renewal_processed",
  "subscription.canceled",
  "subscription.payment_failed",
  "subscription.grace_started",
  "subscription.read_only",
] as const

export type BlackMaskMedusaEvent = (typeof BLACK_MASK_MEDUSA_EVENTS)[number]

export type BlackMaskEnqueueOutcome =
  | { status: "enqueued"; delivery_id: string; event_id: string }
  | {
      status: "skipped"
      reason:
        | "flag_off"
        | "unconfigured"
        | "unknown_event"
        | "missing_subject"
        | "not_found"
        | "not_vault"
        | "legacy_renewal"
        | "renewal_order"
        | "no_sequence"
    }

type Container = { resolve: <T = unknown>(key: string) => T }

type GraphQuery = {
  graph: (args: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type SubscriptionRecord = {
  id: string
  customer_id?: string | null
  product_id?: string | null
  quantity?: number | null
  next_order_date?: Date | string | null
  expiration_date?: Date | string | null
  canceled_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}

type SubscriptionReader = {
  retrieveSubscription: (id: string) => Promise<SubscriptionRecord>
}

type ProductRow = { id?: string; metadata?: unknown; seller?: { id?: string | null } | null }

type OrderRow = {
  id?: string
  customer_id?: string | null
  created_at?: Date | string | null
  canceled_at?: Date | string | null
  items?: Array<{ product_id?: string | null; quantity?: number | null }> | null
}

const ORDER_EVENTS: Partial<Record<BlackMaskMedusaEvent, BlackMaskEvent>> = {
  "order.placed": "placed",
  "order.canceled": "cancelled",
}

const SUBSCRIPTION_EVENTS: Partial<Record<BlackMaskMedusaEvent, BlackMaskEvent>> = {
  "subscription.renewal_processed": "renewed",
  "subscription.canceled": "cancelled",
  "subscription.payment_failed": "payment_failed",
  "subscription.grace_started": "grace_started",
  "subscription.read_only": "read_only",
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function productsById(query: GraphQuery, ids: string[]): Promise<Map<string, ProductRow>> {
  const out = new Map<string, ProductRow>()
  if (ids.length === 0) return out
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "metadata", "seller.id"],
    filters: { id: ids },
  })
  for (const p of (data ?? []) as ProductRow[]) {
    if (p?.id) out.set(p.id, p)
  }
  return out
}

function vaultPlan(product: ProductRow | undefined, cfg: BlackMaskConfig): string | null {
  if (!product) return null
  const ok = isBlackMaskVaultLine(
    { productSellerId: product.seller?.id ?? null, productMetadata: product.metadata },
    cfg.sellerId
  )
  return ok ? blackMaskPlanCode(product.metadata) : null
}

type OrderLineage = { subscriptionId: string | null; isRenewal: boolean }

/**
 * Which subscription an order belongs to, and whether it is a renewal of it,
 * read from the subscription<->order link only (never from cart/order/line
 * metadata, which the store API lets a customer write). Every order of a
 * subscription is linked to it: createSubscriptionStep links the initial
 * order, renewSubscriptionWorkflow links each renewal order before its
 * order.placed is released. An order is a renewal when the subscription has
 * an EARLIER linked order (created_at, then id as the tie-break).
 *
 * Throws on a read failure: for `placed` that must fail closed (the subscriber
 * logs it, nothing is enqueued), since sending a renewal as `placed` would
 * re-send the customer email.
 */
async function orderLineage(query: GraphQuery, orderId: string): Promise<OrderLineage> {
  const { data } = await query.graph({
    entity: subscriptionOrderLink.entryPoint,
    fields: ["subscription.id"],
    filters: { order_id: orderId },
  })
  const row = (data ?? [])[0] as { subscription?: { id?: string } } | undefined
  const subscriptionId = str(row?.subscription?.id)
  if (!subscriptionId) return { subscriptionId: null, isRenewal: false }

  const { data: linked } = await query.graph({
    entity: subscriptionOrderLink.entryPoint,
    fields: ["order.id", "order.created_at"],
    filters: { subscription_id: subscriptionId },
  })
  const orders = ((linked ?? []) as Array<{ order?: { id?: string; created_at?: Date | string | null } | null }>)
    .map((r) => ({ id: str(r?.order?.id), at: sequenceFrom(r?.order?.created_at) ?? Number.POSITIVE_INFINITY }))
    .filter((o): o is { id: string; at: number } => !!o.id)
  const self = orders.find((o) => o.id === orderId)
  const isRenewal = orders.some(
    (o) => o.id !== orderId && (!self || o.at < self.at || (o.at === self.at && o.id < orderId))
  )
  return { subscriptionId, isRenewal }
}

async function orderLineageOrNull(query: GraphQuery, orderId: string): Promise<OrderLineage> {
  try {
    return await orderLineage(query, orderId)
  } catch {
    // On `cancelled` the correlation id is a convenience for the receiver,
    // not a gate.
    return { subscriptionId: null, isRenewal: false }
  }
}

async function orderPayload(
  container: Container,
  cfg: BlackMaskConfig,
  event: BlackMaskEvent,
  data: Record<string, unknown>
): Promise<BlackMaskStoredPayload | BlackMaskEnqueueOutcome> {
  const orderId = str(data.id)
  if (!orderId) return { status: "skipped", reason: "missing_subject" }

  const query = container.resolve<GraphQuery>(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "customer_id",
      "created_at",
      "canceled_at",
      "items.product_id",
      "items.quantity",
    ],
    filters: { id: orderId },
  })
  const order = (orders ?? [])[0] as OrderRow | undefined
  if (!order?.id) return { status: "skipped", reason: "not_found" }

  const items = order.items ?? []
  const productIds = [...new Set(items.map((i) => str(i.product_id)).filter((x): x is string => !!x))]
  const products = await productsById(query, productIds)

  // First vault line names the plan; seats are the quantity across lines of
  // that plan. Lines of any other product are ignored, never counted.
  let plan: string | null = null
  let seats = 0
  for (const item of items) {
    const pid = str(item.product_id)
    const linePlan = pid ? vaultPlan(products.get(pid), cfg) : null
    if (!linePlan) continue
    if (plan === null) plan = linePlan
    if (linePlan === plan) seats += Math.max(0, Math.trunc(Number(item.quantity ?? 0)))
  }
  if (!plan) return { status: "skipped", reason: "not_vault" }

  const sequence = sequenceFrom(event === "placed" ? order.created_at : order.canceled_at)
  if (sequence === null) return { status: "skipped", reason: "no_sequence" }

  const lineage =
    event === "placed" ? await orderLineage(query, order.id) : await orderLineageOrNull(query, order.id)
  if (event === "placed" && lineage.isRenewal) return { status: "skipped", reason: "renewal_order" }

  return buildBlackMaskPayload({
    event,
    subject: { type: "order", id: order.id },
    sequence,
    customerId: order.customer_id ?? null,
    plan,
    seats,
    sellerId: cfg.sellerId,
    subscriptionId: lineage.subscriptionId,
  })
}

async function subscriptionPayload(
  container: Container,
  cfg: BlackMaskConfig,
  event: BlackMaskEvent,
  data: Record<string, unknown>
): Promise<BlackMaskStoredPayload | BlackMaskEnqueueOutcome> {
  const subscriptionId = str(data.subscription_id)
  if (!subscriptionId) return { status: "skipped", reason: "missing_subject" }

  // A renewal is only real money with FBM_SUBSCRIPTION_RENEWAL_LIVE=1, and
  // only then does the event carry the renewal order. Legacy mode advances
  // dates without charging; announcing that as "renewed" would extend a
  // vault for free.
  const renewalOrderId = event === "renewed" ? str(data.order_id) : null
  if (event === "renewed" && !renewalOrderId) {
    return { status: "skipped", reason: "legacy_renewal" }
  }

  const subscriptions = container.resolve<SubscriptionReader>(SUBSCRIPTION_MODULE)
  const subscription = await subscriptions.retrieveSubscription(subscriptionId)
  if (!subscription?.id) return { status: "skipped", reason: "not_found" }

  const query = container.resolve<GraphQuery>(ContainerRegistrationKeys.QUERY)
  const productId = str(subscription.product_id)
  const products = await productsById(query, productId ? [productId] : [])
  const plan = productId ? vaultPlan(products.get(productId), cfg) : null
  if (!plan) return { status: "skipped", reason: "not_vault" }

  let sequence: number | null = null
  switch (event) {
    case "renewed": {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "created_at"],
        filters: { id: renewalOrderId },
      })
      sequence = sequenceFrom(((orders ?? [])[0] as OrderRow | undefined)?.created_at)
      break
    }
    case "cancelled":
      sequence = sequenceFrom(subscription.canceled_at)
      break
    case "payment_failed": {
      const at = subscription.metadata?.["dunning_last_attempt_at"]
      sequence = typeof at === "string" ? sequenceFrom(at) : null
      break
    }
    default: {
      // grace_started / read_only are emitted by a sibling slice, which must
      // put the transition time on the event as `occurred_at`. Without it
      // there is no stable sequence and nothing is enqueued.
      const occurred = data.occurred_at
      sequence = typeof occurred === "string" || occurred instanceof Date ? sequenceFrom(occurred) : null
    }
  }
  if (sequence === null) return { status: "skipped", reason: "no_sequence" }

  return buildBlackMaskPayload({
    event,
    subject: { type: "subscription", id: subscription.id },
    sequence,
    customerId: subscription.customer_id ?? null,
    plan,
    seats: subscription.quantity ?? 1,
    sellerId: cfg.sellerId,
    periodEnd: subscription.next_order_date ?? subscription.expiration_date ?? null,
    orderId: renewalOrderId,
  })
}

export async function enqueueBlackMaskProvisioning(
  container: Container,
  eventName: string,
  data: Record<string, unknown> | null | undefined
): Promise<BlackMaskEnqueueOutcome> {
  if (!isBlackMaskProvisioningEnabled()) return { status: "skipped", reason: "flag_off" }
  const cfg = blackMaskProvisioningConfig()
  if (!cfg) return { status: "skipped", reason: "unconfigured" }

  const name = eventName as BlackMaskMedusaEvent
  const orderEvent = ORDER_EVENTS[name]
  const subscriptionEvent = SUBSCRIPTION_EVENTS[name]
  if (!orderEvent && !subscriptionEvent) return { status: "skipped", reason: "unknown_event" }

  const input = data ?? {}
  const built = orderEvent
    ? await orderPayload(container, cfg, orderEvent, input)
    : await subscriptionPayload(container, cfg, subscriptionEvent as BlackMaskEvent, input)
  if ("status" in built) return built

  const webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  const delivery = await webhooks.emitBlackMask(built)
  if (!delivery) return { status: "skipped", reason: "unconfigured" }
  log.info(`[black-mask] enqueued ${built.event_id} as ${delivery.id}`)
  return { status: "enqueued", delivery_id: delivery.id, event_id: built.event_id }
}

/**
 * The send-time customer read the drain is handed. Returns the customer's
 * email and metadata; deliverableEmail() decides whether the address may
 * leave FBM. Never cached, never written anywhere.
 */
export function makeBlackMaskCustomerLookup(container: Container): BlackMaskCustomerLookup {
  return async (customerId: string) => {
    const query = container.resolve<GraphQuery>(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "metadata"],
      filters: { id: customerId },
    })
    const row = (data ?? [])[0] as { email?: string | null; metadata?: unknown } | undefined
    return row ? { email: row.email ?? null, metadata: row.metadata ?? null } : null
  }
}
