import { createLogger } from "../shared/logger"
const log = createLogger("lib/card-stripe-sync")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Stripe from "stripe"
import { featureFlagState } from "../shared/feature-flags"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { ordersForPaymentCollection } from "./card-order-settlement"
import {
  RENEWAL_RECORD_METADATA_KEY,
  RENEWAL_RECORD_PROVIDER_ID,
  renewalRecordClaim,
} from "../workflows/subscription/renew-helpers"
import { reconcileCardOrder, type CardOrderReconcileOutcome } from "./card-order-reconcile"

/**
 * Stripe-dashboard refunds and chargebacks into the ledger (SD-43; operator
 * answer 2026-10-06: "listen to Stripe; a chargeback counts as a refund of
 * that order"; FF_CARD_ORDER_LEDGER_V1).
 *
 * A refund issued in the Stripe dashboard, and a dispute, change what FBM's
 * Stripe account holds for a card order without Medusa ever hearing of it.
 * `subscribers/hawala-card-stripe-events.ts` hands every verified charge or
 * dispute event here, and this:
 *
 *   1. re-reads the charge from Stripe (the event is only a trigger, so a
 *      repeated or out-of-order delivery cannot leave a stale figure) —
 *      `amount_refunded`, and every dispute on it, lost or still open;
 *   2. finds the Medusa payment that charge paid (its PaymentIntent is the
 *      payment's `data.id`, as `@medusajs/payment-stripe` stores it — or, for
 *      a subscription renewal FBM charged directly, the bookkeeping payment
 *      naming that intent on an order linked to its subscription, SD-46), and
 *      ignores anything not paid through FBM's own Stripe account;
 *   3. records the charge's state (`hawala-ledger/models/card-charge-state.ts`);
 *   4. reconciles every order on that payment collection through the one
 *      locked entry point (`lib/card-order-reconcile.ts`), which now reads
 *      that state: a refund or lost dispute beyond what Medusa recorded posts
 *      as a refund of the order (or, on a shared Mercur cart, holds its
 *      sellers until an admin assigns it, SD-40); an open dispute holds the
 *      sellers until it closes.
 *
 * It never refunds anything at Stripe: it only reads. Never throws.
 */

/** The charge and dispute events that can change what a charge kept. */
export const CARD_LEDGER_STRIPE_EVENTS = new Set([
  "charge.refunded",
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
])

/** Disputes that may still take the money: held, not yet posted. */
const OPEN_DISPUTE_STATUSES = new Set([
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
])

type Container = { resolve: (key: string) => unknown }

export type ChargeLedgerState = {
  charge_id: string
  payment_intent_id: string | null
  currency: string
  amount_cents: number
  refunded_cents: number
  dispute_lost_cents: number
  dispute_open_cents: number
  /** Stripe's dispute fees on the charge, net, in USD cents (`disputeFeeCents`). */
  dispute_fee_cents?: number
  /**
   * The largest amount any ONE chargeback on the charge covered, whatever its
   * outcome, in cents; inquiries (`warning_*`) are left out. On a shared cart
   * the fee is put on the orders only when this reaches the charge amount —
   * a sum would let an inquiry, or two partial chargebacks, pass for a
   * whole-charge one.
   */
  disputed_cents?: number
}

export type ChargeFetcher = (chargeId: string) => Promise<ChargeLedgerState>

export type CardStripeSyncOutcome =
  | { outcome: "flag_off" | "not_found" | "not_fbm_card" | "failed"; charge_id: string }
  | { outcome: "synced"; charge_id: string; reconciled: Array<{ order_id: string; outcome: CardOrderReconcileOutcome }> }

/** The charge a charge, refund or dispute event is about; null for anything else. */
export function chargeIdOfStripeEvent(event: { type?: string; data?: { object?: unknown } }): string | null {
  if (!event?.type || !CARD_LEDGER_STRIPE_EVENTS.has(event.type)) return null
  const object = (event.data?.object ?? {}) as { object?: string; id?: string; charge?: unknown }
  if (object.object === "charge") return typeof object.id === "string" ? object.id : null
  const charge = object.charge
  if (typeof charge === "string") return charge
  if (charge && typeof charge === "object" && typeof (charge as { id?: unknown }).id === "string") {
    return (charge as { id: string }).id
  }
  return null
}

type DisputeLike = {
  status?: string | null
  amount?: number | null
  balance_transactions?: Array<{ fee?: number | null; currency?: string | null } | null> | null
}

/**
 * What Stripe kept in dispute fees on a charge: the sum of `fee` over every
 * balance transaction of every dispute (Stripe lists the withdrawal, and any
 * reinstatement, on the dispute itself; a returned fee shows as a negative
 * fee, so the sum is net). USD balance transactions only — FBM's Stripe
 * account settles in USD; anything else is not counted and the caller logs
 * it. Never below zero. The separate "dispute countered fee" Stripe takes when
 * a dispute is contested is NOT on the dispute's balance transactions, so it
 * is never counted here — and must not be: BMC bears it, never a vendor
 * (operator answer 2026-10-07, SD-44).
 */
export function disputeFeeCents(disputes: DisputeLike[]): { cents: number; uncounted: number } {
  let cents = 0
  let uncounted = 0
  for (const d of disputes) {
    for (const bt of d.balance_transactions ?? []) {
      if (!bt || typeof bt.fee !== "number" || !Number.isFinite(bt.fee)) continue
      if (String(bt.currency ?? "").toLowerCase() !== "usd") {
        uncounted++
        continue
      }
      cents += bt.fee
    }
  }
  return { cents: Math.max(0, Math.round(cents)), uncounted }
}

/**
 * The largest amount any one chargeback covered (`disputed_cents`):
 * inquiries (`warning_*` statuses) are left out, and disputes are not summed.
 */
export function largestChargebackCents(disputes: Array<{ status?: string | null; amount?: number | null }>): number {
  let largest = 0
  for (const d of disputes) {
    if (String(d.status ?? "").startsWith("warning_")) continue
    if (typeof d.amount === "number" && Number.isFinite(d.amount)) largest = Math.max(largest, d.amount)
  }
  return Math.max(0, Math.round(largest))
}

/** Stripe, read with the same key FBM's Stripe payment provider uses. */
export function stripeChargeFetcher(apiKey = process.env.STRIPE_API_KEY ?? ""): ChargeFetcher {
  return async (chargeId) => {
    const stripe = new Stripe(apiKey)
    const charge = await stripe.charges.retrieve(chargeId)
    let lost = 0
    let open = 0
    const disputes: DisputeLike[] = []
    for await (const dispute of stripe.disputes.list({ charge: chargeId, limit: 100 })) {
      if (dispute.status === "lost") lost += dispute.amount
      else if (OPEN_DISPUTE_STATUSES.has(dispute.status)) open += dispute.amount
      disputes.push(dispute)
    }
    const fee = disputeFeeCents(disputes)
    if (fee.uncounted > 0) {
      log.warn(`[Hawala] Charge ${chargeId}: ${fee.uncounted} dispute balance transaction(s) not in USD; their fees are not counted`)
    }
    const pi = charge.payment_intent
    return {
      charge_id: charge.id,
      payment_intent_id: typeof pi === "string" ? pi : pi?.id ?? null,
      currency: charge.currency,
      amount_cents: charge.amount,
      refunded_cents: charge.amount_refunded,
      dispute_lost_cents: lost,
      dispute_open_cents: open,
      dispute_fee_cents: fee.cents,
      disputed_cents: largestChargebackCents(disputes),
    }
  }
}

/** Charges with a refund or dispute created at Stripe since a time; for the hourly re-read. */
export type RecentChargeLister = (since: Date) => Promise<string[]>

/**
 * Every charge Stripe shows a refund or a dispute on since `since`, from FBM's
 * own Stripe account (the payment provider's key). Catches what a lost webhook
 * never delivered (`jobs/hawala-card-stripe-resync.ts`).
 */
export function stripeRecentChargeLister(apiKey = process.env.STRIPE_API_KEY ?? ""): RecentChargeLister {
  return async (since) => {
    const stripe = new Stripe(apiKey)
    const created = { gte: Math.floor(since.getTime() / 1000) }
    const ids = new Set<string>()
    const add = (charge: string | { id: string } | null | undefined) => {
      const id = typeof charge === "string" ? charge : charge?.id
      if (id) ids.add(id)
    }
    for await (const dispute of stripe.disputes.list({ created, limit: 100 })) add(dispute.charge)
    for await (const refund of stripe.refunds.list({ created, limit: 100 })) add(refund.charge)
    return [...ids]
  }
}

type PgLike = { raw: (sql: string, b?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }> }

type IntentPayment = { id: string; payment_collection_id: string; provider_id: string; renewal_record: boolean }

/** The Medusa payment a PaymentIntent paid: `@medusajs/payment-stripe` stores the intent as `data`. */
async function paymentForIntent(container: Container, paymentIntentId: string): Promise<IntentPayment | null> {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgLike
  const result = await pg.raw(
    `SELECT id, payment_collection_id, provider_id
       FROM payment
      WHERE data->>'id' = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [paymentIntentId]
  )
  const row = result?.rows?.[0]
  if (row && typeof row.id === "string" && typeof row.payment_collection_id === "string") {
    return { id: row.id, payment_collection_id: row.payment_collection_id, provider_id: String(row.provider_id ?? ""), renewal_record: false }
  }
  return renewalPaymentForIntent(container, pg, paymentIntentId)
}

/**
 * The subscription-order link's query entry point, loaded on first use with
 * `require` (the `lib/blackout-cycle.ts` pattern): `defineLink` runs at module
 * load and needs the module registry, so a static import would break every
 * unit test that reaches this file. Only a renewal read gets here.
 */
function subscriptionOrderEntryPoint(): string {
  return (require("../links/subscription-order") as { default: { entryPoint: string } }).default.entryPoint
}

/**
 * A subscription renewal FBM charged with its own PaymentIntent (SD-46,
 * `FF_CONSUMER_SUBSCRIPTIONS_V1`): the bookkeeping payment whose `metadata`
 * record names that intent, accepted only on an order linked to the
 * subscription the record names — so a payment carrying a copy of someone
 * else's record is never picked.
 */
async function renewalPaymentForIntent(
  container: Container,
  pg: PgLike,
  paymentIntentId: string
): Promise<IntentPayment | null> {
  if (!featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")) return null
  const result = await pg.raw(
    `SELECT id, payment_collection_id, provider_id, metadata
       FROM payment
      WHERE provider_id = ? AND metadata->?->>'stripe_payment_intent_id' = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [RENEWAL_RECORD_PROVIDER_ID, RENEWAL_RECORD_METADATA_KEY, paymentIntentId]
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (q: Record<string, unknown>) => Promise<{ data: unknown[] }>
  }
  for (const row of result?.rows ?? []) {
    const claim = renewalRecordClaim(row.provider_id, row.metadata)
    if (!claim || claim.payment_intent_id !== paymentIntentId) continue
    if (typeof row.id !== "string" || typeof row.payment_collection_id !== "string") continue
    const orderIds = await ordersForPaymentCollection(container, row.payment_collection_id)
    if (orderIds.length === 0) continue
    const { data } = await query.graph({
      entity: subscriptionOrderEntryPoint(),
      fields: ["subscription_id", "order_id"],
      filters: { order_id: orderIds, subscription_id: claim.subscription_id },
    })
    if (data.length > 0) {
      return { id: row.id, payment_collection_id: row.payment_collection_id, provider_id: String(row.provider_id), renewal_record: true }
    }
    log.error(`[Hawala] Payment ${row.id} names renewal intent ${paymentIntentId} but its order is not linked to that subscription; ignored`)
  }
  return null
}

export async function syncCardChargeFromStripe(
  container: Container,
  chargeId: string,
  deps: { fetchCharge?: ChargeFetcher } = {}
): Promise<CardStripeSyncOutcome> {
  if (!featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")) return { outcome: "flag_off", charge_id: chargeId }
  try {
    const state = await (deps.fetchCharge ?? stripeChargeFetcher())(chargeId)
    if (!state.payment_intent_id) return { outcome: "not_found", charge_id: chargeId }
    const payment = await paymentForIntent(container, state.payment_intent_id)
    if (!payment) return { outcome: "not_found", charge_id: chargeId }
    if (!payment.renewal_record && !isFbmCardProvider(payment.provider_id)) return { outcome: "not_fbm_card", charge_id: chargeId }

    const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
    const row = {
      stripe_charge_id: state.charge_id,
      payment_intent_id: state.payment_intent_id,
      payment_id: payment.id,
      payment_collection_id: payment.payment_collection_id,
      currency_code: state.currency,
      amount_cents: state.amount_cents,
      refunded_cents: state.refunded_cents,
      dispute_lost_cents: state.dispute_lost_cents,
      dispute_open_cents: state.dispute_open_cents,
      dispute_fee_cents: Math.max(0, Math.round(state.dispute_fee_cents ?? 0)),
      disputed_cents: Math.max(0, Math.round(state.disputed_cents ?? 0)),
      synced_at: new Date(),
    }
    const [existing] = await hawala.listCardChargeStates({ stripe_charge_id: state.charge_id })
    if (existing) {
      await hawala.updateCardChargeStates({ id: existing.id, ...row })
    } else {
      try {
        await hawala.createCardChargeStates(row)
      } catch (error) {
        // A concurrent delivery inserted it first (partial unique index):
        // write the fresh read over it.
        const [raced] = await hawala.listCardChargeStates({ stripe_charge_id: state.charge_id })
        if (!raced) throw error
        await hawala.updateCardChargeStates({ id: raced.id, ...row })
      }
    }

    const reconciled: Array<{ order_id: string; outcome: CardOrderReconcileOutcome }> = []
    for (const orderId of await ordersForPaymentCollection(container, payment.payment_collection_id)) {
      const { outcome } = await reconcileCardOrder(container, orderId)
      reconciled.push({ order_id: orderId, outcome })
    }
    return { outcome: "synced", charge_id: chargeId, reconciled }
  } catch (error) {
    log.error(`[Hawala] Could not sync card charge ${chargeId} from Stripe:`, error)
    return { outcome: "failed", charge_id: chargeId }
  }
}
