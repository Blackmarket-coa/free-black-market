import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-order-settlement")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../modules/stripe-connect-direct/registration"

/**
 * How a card order's money is read for the hawala ledger (SD-36 / SD-39,
 * `FF_CARD_ORDER_LEDGER_V1`). Every amount here comes from `query.graph`,
 * proved against a real migrated database
 * (`integration-tests/http/hawala-card-order-settlement.spec.ts`):
 *
 *   - Amounts are MAJOR units, as Medusa v2 stores them ($40.00 is `40`);
 *     `@medusajs/payment-stripe` multiplies by 100 when it calls Stripe. The
 *     legacy settlement treated `order.total` as cents (SD-39).
 *   - `total` / `subtotal` are computed only when the item pricing fields
 *     are selected, so `items.*` is always read with them.
 *   - The seller is Mercur's `seller` link; there is no `order.seller_id`
 *     (the legacy path credited a placeholder "default-seller" account).
 *
 * Captured / refunded per ORDER — the ledger settles and refunds orders, but
 * Stripe captures and refunds payment collections:
 *
 *   - Mercur cart (`splitAndCompleteCartWorkflow`): one payment collection,
 *     one order per seller, and one `split_order_payment` row per order with
 *     that order's own authorized / captured / refunded amounts. Mercur
 *     captures the whole collection at once (`order-set-placed-payment-
 *     capture`) and only then marks every split captured, so once the
 *     collection is fully captured every split is too — that is read
 *     directly, so the `payment.captured` subscriber never races Mercur's
 *     follow-up update. Refunds through Mercur update the split's
 *     `refunded_amount` and emit no event (the reconciler job covers them).
 *   - A single-order checkout (`completeCartWorkflow`): no split row; the
 *     order's own payment collection, used only when no other order shares
 *     it, so a collection's money is never attributed to the wrong order.
 *
 * Anything that cannot be attributed to one order with certainty yields
 * `null`, and nothing settles or refunds for it.
 */

type Container = { resolve: (key: string) => any }

export type CardSettlementFunding = "fbm_card" | "connect_direct" | "other"

export type CardSettlementOrder = {
  id: string
  customer_id: string | null
  seller_id: string | null
  currency_code: string
  /** Major units, as stored. */
  total: number
  subtotal: number
  items: Array<{ product_id: string | null }>
  metadata: Record<string, unknown>
  funding: CardSettlementFunding
  /** The payment collection(s) this order's money moved through. */
  payment_collection_ids: string[]
  /** What was captured / refunded for THIS order, major units; null = unknown. */
  captured: number | null
  refunded: number | null
  /**
   * Refunded on this order's shared payment collection but recorded on no
   * order's split row (a Medusa-native refund or admin cancel on a Mercur
   * cart), major units; null when there is none or it cannot arise.
   */
  unattributed_refund: number | null
  /** The FBM Stripe payment the purchase leg is stamped with, if any. */
  payment_id: string | null
}

/** Cent-exact comparison of major-unit amounts. */
export const toCents = (major: number) => Math.round(major * 100)

const n = (v: unknown): number | null => {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

type RawCollection = {
  id?: string
  amount?: unknown
  captured_amount?: unknown
  refunded_amount?: unknown
  payments?: Array<{ id?: string; provider_id?: string | null } | null> | null
} | null

/** Orders linked to a payment collection (core link), for the single-order check. */
async function ordersOnCollection(query: any, paymentCollectionId: string): Promise<string[]> {
  const { data } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id", "payment_collection_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })
  return [...new Set((data as Array<{ order_id?: string }>).map((r) => r.order_id).filter((x): x is string => !!x))]
}

export async function readCardSettlementOrder(
  container: Container,
  orderId: string
): Promise<CardSettlementOrder | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "customer_id",
      "currency_code",
      "metadata",
      "total",
      "subtotal",
      "items.*",
      "seller.id",
      "split_order_payment.id",
      "split_order_payment.authorized_amount",
      "split_order_payment.captured_amount",
      "split_order_payment.refunded_amount",
      "split_order_payment.payment_collection_id",
      "payment_collections.id",
      "payment_collections.amount",
      "payment_collections.captured_amount",
      "payment_collections.refunded_amount",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
    ],
    filters: { id: orderId },
  })
  const row = (data as Array<Record<string, any>>)[0]
  if (!row) return null

  const total = n(row.total)
  const subtotal = n(row.subtotal)
  if (total === null || subtotal === null) return null

  const collections = ((row.payment_collections ?? []) as RawCollection[]).filter(
    (c): c is NonNullable<RawCollection> => !!c && typeof c.id === "string"
  )
  const split = row.split_order_payment as
    | { authorized_amount?: unknown; captured_amount?: unknown; refunded_amount?: unknown; payment_collection_id?: string }
    | null
    | undefined

  // The collection(s) carrying this order's money: the split's own, when
  // Mercur split the cart; otherwise the order's linked collections.
  const ownCollections = split?.payment_collection_id
    ? collections.filter((c) => c.id === split.payment_collection_id)
    : collections
  const payments = ownCollections.flatMap((c) => (c.payments ?? []).filter((p): p is { id?: string; provider_id?: string | null } => !!p))
  const providers = payments.map((p) => p.provider_id).filter((p): p is string => !!p)
  const funding: CardSettlementFunding = providers.some((p) => p === STRIPE_CONNECT_DIRECT_PROVIDER_ID)
    ? "connect_direct"
    : providers.some(isFbmCardProvider)
      ? "fbm_card"
      : "other"
  const cardPayment = payments.find((p) => isFbmCardProvider(p.provider_id))

  let captured: number | null = null
  let refunded: number | null = null
  let unattributedRefund: number | null = null
  if (split) {
    const collection = ownCollections[0]
    const cAmount = n(collection?.amount)
    const cCaptured = n(collection?.captured_amount)
    const cRefunded = n(collection?.refunded_amount) ?? 0
    const collectionFullyCaptured = cCaptured !== null && cAmount !== null && toCents(cCaptured) >= toCents(cAmount)
    // Mercur captures the whole collection, then marks each split captured
    // at its authorized amount; read through that follow-up so the capture
    // event never races it.
    captured = collectionFullyCaptured ? n(split.authorized_amount) : n(split.captured_amount)
    refunded = n(split.refunded_amount)
    // Medusa's own refund and cancel flows refund the shared collection
    // without touching any split row. All of it refunded: every order on it
    // is refunded in full (its own captured share). Part of it: what no
    // split accounts for cannot be put on a seller — reported, not guessed.
    if (cCaptured !== null && toCents(cCaptured) > 0 && toCents(cRefunded) >= toCents(cCaptured)) {
      refunded = captured
    } else if (toCents(cRefunded) > 0 && split.payment_collection_id) {
      const { data: siblings } = await query.graph({
        entity: "split_order_payment",
        fields: ["id", "refunded_amount"],
        filters: { payment_collection_id: split.payment_collection_id },
      })
      const recorded = (siblings as Array<{ refunded_amount?: unknown }>).reduce(
        (sum, s) => sum + toCents(n(s.refunded_amount) ?? 0),
        0
      )
      const gap = toCents(cRefunded) - recorded
      if (gap > 0) unattributedRefund = gap / 100
    }
  } else if (ownCollections.length === 1) {
    const only = ownCollections[0]
    const sharers = await ordersOnCollection(query, only.id as string)
    if (sharers.length === 1 && sharers[0] === orderId) {
      captured = n(only.captured_amount)
      refunded = n(only.refunded_amount)
    } else {
      log.warn(
        `[Hawala] Order ${orderId}: payment collection ${only.id} is shared with ${sharers.length - 1} other order(s) ` +
          `and has no split payment record; its money cannot be attributed to one order`
      )
    }
  }

  return {
    id: row.id,
    customer_id: row.customer_id ?? null,
    seller_id: row.seller?.id ?? null,
    currency_code: String(row.currency_code ?? "").toLowerCase(),
    total,
    subtotal,
    items: ((row.items ?? []) as Array<{ product_id?: string | null } | null>).map((i) => ({
      product_id: i?.product_id ?? null,
    })),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    funding,
    payment_collection_ids: ownCollections.map((c) => c.id as string),
    captured,
    refunded,
    unattributed_refund: unattributedRefund,
    payment_id: cardPayment?.id ?? null,
  }
}


/** Fully captured, by this order's own record. */
export function isFullyCaptured(order: CardSettlementOrder): boolean {
  return order.captured !== null && toCents(order.captured) >= toCents(order.total) && toCents(order.total) > 0
}

/**
 * Every order whose money moved through a payment collection: Mercur's split
 * rows first, then the core link. Used by the capture / refund subscribers,
 * whose events carry only a payment id.
 */
export async function ordersForPaymentCollection(container: Container, paymentCollectionId: string): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const ids = new Set<string>()
  const { data: splits } = await query.graph({
    entity: "split_order_payment",
    fields: ["id", "order.id"],
    filters: { payment_collection_id: paymentCollectionId },
  })
  for (const s of splits as Array<{ order?: { id?: string } | null }>) if (s.order?.id) ids.add(s.order.id)
  for (const id of await ordersOnCollection(query, paymentCollectionId)) ids.add(id)
  return [...ids]
}

/** The payment collection a payment belongs to, and its provider. */
export async function readPayment(
  container: Container,
  paymentId: string
): Promise<{ id: string; provider_id: string | null; payment_collection_id: string | null } | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "payment",
    fields: ["id", "provider_id", "payment_collection_id"],
    filters: { id: paymentId },
  })
  const p = (data as Array<{ id: string; provider_id?: string | null; payment_collection_id?: string | null }>)[0]
  return p ? { id: p.id, provider_id: p.provider_id ?? null, payment_collection_id: p.payment_collection_id ?? null } : null
}
