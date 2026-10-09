import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-order-settlement")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../modules/stripe-connect-direct/registration"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { featureFlagState } from "../shared/feature-flags"
import { renewalRecordClaim } from "../workflows/subscription/renew-helpers"
import subscriptionOrderLink from "../links/subscription-order"

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
 *   - A subscription renewal (F5 / SD-46, `FF_CONSUMER_SUBSCRIPTIONS_V1`):
 *     FBM collected the cycle with its own off-session PaymentIntent and the
 *     order's `pp_system_default` payment carries the record of it in its
 *     `metadata` (`workflows/subscription/renew-helpers.ts`). That is FBM
 *     card money, read so only when the order is also linked to the
 *     subscription the record names. Its refunds are Stripe's figure alone:
 *     a refund recorded in Medusa on a system payment moves no money.
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
  /**
   * Whether every refund on this order's shared (Mercur) collection is
   * accounted for by some order's split row (SD-40): `complete` — nothing
   * refunded, refunded in full, or the splits record all of it; `gap` —
   * `unattributed_refund` is the part no split records; `unknown` — not a
   * split order, or the collection could not be read. Payout holds are
   * released only on `complete`.
   */
  refund_attribution: "complete" | "gap" | "unknown"
  /**
   * Held by an open card dispute on this order's collection (SD-43), major
   * units; 0 when none. Nothing is posted for it while it is open.
   */
  dispute_open: number
  /** The FBM Stripe payment the purchase leg is stamped with, if any. */
  payment_id: string | null
}

/** Cent-exact comparison of major-unit amounts. */
export const toCents = (major: number) => Math.round(major * 100)

const n = (v: unknown): number | null => {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

type RawPayment = { id?: string; provider_id?: string | null; metadata?: Record<string, unknown> | null }

type RawCollection = {
  id?: string
  amount?: unknown
  captured_amount?: unknown
  refunded_amount?: unknown
  payments?: Array<RawPayment | null> | null
} | null

/**
 * The renewal-record payment among `payments` whose claimed subscription the
 * order is actually linked to (SD-46); null when there is none, or with
 * `FF_CONSUMER_SUBSCRIPTIONS_V1` off.
 */
async function verifiedRenewalRecord(query: any, orderId: string, payments: RawPayment[]): Promise<RawPayment | null> {
  if (!featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")) return null
  const claimed = payments
    .map((p) => ({ p, claim: renewalRecordClaim(p.provider_id, p.metadata) }))
    .filter((x): x is { p: RawPayment; claim: { subscription_id: string; payment_intent_id: string } } => !!x.claim)
  if (claimed.length === 0) return null
  const { data } = await query.graph({
    entity: subscriptionOrderLink.entryPoint,
    fields: ["subscription_id", "order_id"],
    filters: { order_id: orderId },
  })
  const linked = new Set((data as Array<{ subscription_id?: string }>).map((r) => r.subscription_id).filter(Boolean))
  const verified = claimed.filter((x) => linked.has(x.claim.subscription_id))
  if (verified.length !== claimed.length) {
    log.error(
      `[Hawala] Order ${orderId}: a payment claims a subscription renewal the order is not linked to; it is not read as card money`
    )
  }
  return verified.length === 1 ? verified[0].p : null
}

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
      "payment_collections.payments.metadata",
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
  const payments = ownCollections.flatMap((c) => (c.payments ?? []).filter((p): p is RawPayment => !!p))
  const providers = payments.map((p) => p.provider_id).filter((p): p is string => !!p)
  const renewalRecord =
    split || providers.some((p) => p === STRIPE_CONNECT_DIRECT_PROVIDER_ID || isFbmCardProvider(p))
      ? null
      : await verifiedRenewalRecord(query, orderId, payments)
  const funding: CardSettlementFunding = providers.some((p) => p === STRIPE_CONNECT_DIRECT_PROVIDER_ID)
    ? "connect_direct"
    : providers.some(isFbmCardProvider) || renewalRecord
      ? "fbm_card"
      : "other"
  const cardPayment = payments.find((p) => isFbmCardProvider(p.provider_id)) ?? renewalRecord ?? undefined

  // What Stripe says beyond Medusa (SD-43, `hawala-ledger/models/card-charge-state.ts`):
  // refunds issued in the Stripe dashboard and disputes lost count as
  // refunded on the collection; Stripe's `amount_refunded` already includes
  // refunds made through Medusa, so the larger of the two figures is taken,
  // never their sum. Open disputes are reported, not posted.
  let stripeRefundedCents = 0
  let disputeOpenCents = 0
  const collectionIds = ownCollections.map((c) => c.id as string)
  if (collectionIds.length > 0) {
    const hawala = container.resolve(HAWALA_LEDGER_MODULE) as {
      listCardChargeStates?: (
        filters: Record<string, unknown>
      ) => Promise<Array<{ refunded_cents?: unknown; dispute_lost_cents?: unknown; dispute_open_cents?: unknown }>>
    }
    const states = (await hawala.listCardChargeStates?.({ payment_collection_id: collectionIds })) ?? []
    for (const st of states) {
      stripeRefundedCents += (Number(st.refunded_cents) || 0) + (Number(st.dispute_lost_cents) || 0)
      disputeOpenCents += Number(st.dispute_open_cents) || 0
    }
  }
  const withStripe = (medusaMajor: number | null): number | null =>
    stripeRefundedCents > 0 ? Math.max(toCents(medusaMajor ?? 0), stripeRefundedCents) / 100 : medusaMajor

  let captured: number | null = null
  let refunded: number | null = null
  let unattributedRefund: number | null = null
  let refundAttribution: CardSettlementOrder["refund_attribution"] = "unknown"
  if (split) {
    const collection = ownCollections[0]
    const cAmount = n(collection?.amount)
    const cCaptured = n(collection?.captured_amount)
    const cRefunded = withStripe(n(collection?.refunded_amount)) ?? 0
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
      refundAttribution = "complete"
    } else if (collection && toCents(cRefunded) === 0) {
      refundAttribution = "complete"
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
      refundAttribution = gap > 0 ? "gap" : "complete"
    }
  } else if (ownCollections.length === 1) {
    const only = ownCollections[0]
    const sharers = await ordersOnCollection(query, only.id as string)
    if (sharers.length === 1 && sharers[0] === orderId) {
      captured = n(only.captured_amount)
      refunded = renewalRecord ? stripeRefundedCents / 100 : withStripe(n(only.refunded_amount))
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
    refund_attribution: refundAttribution,
    dispute_open: disputeOpenCents / 100,
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

/**
 * The seller of every order whose money moved through a payment collection
 * (SD-40: everyone a hold on that collection applies to).
 */
export async function sellersForPaymentCollection(
  container: Container,
  paymentCollectionId: string
): Promise<{ order_ids: string[]; seller_ids: string[] }> {
  const orderIds = await ordersForPaymentCollection(container, paymentCollectionId)
  if (orderIds.length === 0) return { order_ids: [], seller_ids: [] }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "seller.id"],
    filters: { id: orderIds },
  })
  const sellerIds = (data as Array<{ seller?: { id?: string } | null }>)
    .map((o) => o.seller?.id)
    .filter((x): x is string => !!x)
  return { order_ids: orderIds, seller_ids: [...new Set(sellerIds)] }
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
