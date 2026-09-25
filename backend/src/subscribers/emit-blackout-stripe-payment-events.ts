import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-stripe-payment-events")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import {
  ContainerRegistrationKeys,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import Stripe from "stripe"
import { isBlackoutIntegrationEnabled } from "../lib/blackout-oauth"
import {
  buildPurchaseChargebackedArgs,
  buildPurchaseFailedArgs,
  emitPurchaseChargebacked,
  emitPurchaseFailed,
  isStripeChargebackEvent,
  stripeDisputePaymentIntentId,
  type BlackoutCheckoutSessionLike,
} from "../lib/blackout-stub-emitters"
import { isBlackoutEmitConfigured } from "../modules/marketplace-webhooks/service"
import { MARKETPLACE_LISTING_MODULE } from "../modules/marketplace-listing"
import type MarketplaceListingService from "../modules/marketplace-listing/service"
import { BlackoutCheckoutSessionStatus } from "../modules/marketplace-listing/models"
import { SUBSCRIPTION_PAYMENT_PROVIDER_ID } from "../workflows/subscription/renew-helpers"

/**
 * Report Stripe payment failures and chargebacks on Blackout-checkout
 * purchases to Blackout as §2 `purchase.failed` / `purchase.chargebacked`.
 *
 * Hook point: Medusa's own payment webhook. Stripe posts to
 * `/hooks/payment/<provider>`, and Medusa re-emits the request as
 * `payment.webhook_received` (`{ provider, payload: { rawData, headers } }`)
 * for its `payment-webhook` subscriber, which ignores FAILED actions and gets
 * NOT_SUPPORTED for disputes from the Stripe provider, so neither reaches any
 * FBM flow. This subscriber listens to the same event — no new endpoint —
 * and verifies the Stripe signature itself, against the same
 * `STRIPE_WEBHOOK_SECRET` the Stripe provider is configured with, before
 * reading anything. Stripe only delivers the event types enabled on that
 * endpoint: `payment_intent.payment_failed` plus `charge.dispute.created` /
 * `charge.dispute.funds_withdrawn` must be ticked for these emits to fire.
 *
 * Scope: Blackout-originated purchases only — the cart must belong to a
 * `blackout_checkout_session`, so storefront orders and subscription renewals
 * (which mint their own carts) are never reported. Gated by
 * `FBM_BLACKOUT_INTEGRATION=1` and the outbound emitter config.
 *
 * Events only: nothing here moves money, writes the ledger, refunds, or
 * touches FBM's dispute records. Errors are logged and swallowed so a
 * reporting failure never makes Medusa retry the webhook.
 */
export default async function emitBlackoutStripePaymentEvents({
  event: { data },
  container,
}: SubscriberArgs<PaymentWebhookInput>) {
  if (!isBlackoutIntegrationEnabled() || !isBlackoutEmitConfigured()) {
    return
  }

  try {
    const stripeEvent = verifyStripePaymentWebhook(data)
    if (!stripeEvent) {
      return
    }

    if (stripeEvent.type === "payment_intent.payment_failed") {
      await reportPaymentFailed(
        container,
        stripeEvent.data.object as Stripe.PaymentIntent
      )
    } else if (isStripeChargebackEvent(stripeEvent)) {
      await reportChargeback(container, stripeEvent.data.object as Stripe.Dispute)
    }
  } catch (err) {
    log.error(
      "[emit-blackout-stripe-payment-events] failed:",
      err instanceof Error ? err.message : err
    )
  }
}

export const config: SubscriberConfig = {
  event: PaymentWebhookEvents.WebhookReceived,
}

type PaymentWebhookInput = {
  provider?: unknown
  payload?: {
    rawData?: unknown
    headers?: Record<string, unknown> | null
  } | null
}

/**
 * The raw request bytes Medusa's route captured (`req.rawBody`). A Redis event
 * bus round-trips a Buffer as `{ type: "Buffer", data }`, the same form
 * Medusa's own webhook subscriber revives.
 */
function rawBodyOf(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) {
    return raw
  }
  const serialized = raw as { type?: unknown; data?: unknown } | null
  if (serialized?.type === "Buffer" && Array.isArray(serialized.data)) {
    return Buffer.from(serialized.data as number[])
  }
  return null
}

/**
 * The verified Stripe event carried by a `payment.webhook_received`, or null
 * when it came through another provider, the webhook secret is unset, or the
 * signature does not verify. Only the provider the Blackout checkout pays
 * through (`FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID`, default `pp_stripe_stripe`)
 * is considered.
 */
function verifyStripePaymentWebhook(
  input: PaymentWebhookInput | null | undefined
): Stripe.Event | null {
  const provider = input?.provider
  if (typeof provider !== "string" || `pp_${provider}` !== SUBSCRIPTION_PAYMENT_PROVIDER_ID) {
    return null
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return null
  }
  const rawBody = rawBodyOf(input?.payload?.rawData)
  const header = input?.payload?.headers?.["stripe-signature"]
  const signature = Array.isArray(header) ? header[0] : header
  if (!rawBody || typeof signature !== "string" || !signature) {
    return null
  }
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    log.warn(
      "[emit-blackout-stripe-payment-events] Stripe signature did not verify:",
      err instanceof Error ? err.message : err
    )
    return null
  }
}

type CartPaymentRow = {
  cart_id: string
  cart_completed_at: unknown
  order_id: string | null
  payment_session_status: string | null
}

type PgConnection = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

/**
 * Resolve the cart (and its order, if any) that a Stripe PaymentIntent
 * belongs to. The provider stamps the Medusa payment session id into the
 * intent's `metadata.session_id` and stores the intent as the session's
 * `data`, so a failure resolves by session id and a dispute (which only names
 * the intent) by `data->>'id'`.
 */
async function findCartForPayment(
  container: MedusaContainer,
  by: { sessionId: string } | { paymentIntentId: string }
): Promise<CartPaymentRow | null> {
  const conn = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgConnection
  const [where, value] =
    "sessionId" in by
      ? ["ps.id = ?", by.sessionId]
      : ["ps.data->>'id' = ?", by.paymentIntentId]
  const res = await conn.raw(
    `SELECT cpc.cart_id,
            c.completed_at AS cart_completed_at,
            oc.order_id,
            ps.status AS payment_session_status
       FROM payment_session ps
       JOIN cart_payment_collection cpc
         ON cpc.payment_collection_id = ps.payment_collection_id
        AND cpc.deleted_at IS NULL
       LEFT JOIN cart c ON c.id = cpc.cart_id
       LEFT JOIN order_cart oc ON oc.cart_id = cpc.cart_id AND oc.deleted_at IS NULL
      WHERE ${where}
      ORDER BY ps.created_at DESC
      LIMIT 1`,
    [value]
  )
  const row = res?.rows?.[0]
  if (!row || typeof row.cart_id !== "string" || !row.cart_id) {
    return null
  }
  return {
    cart_id: row.cart_id,
    cart_completed_at: row.cart_completed_at ?? null,
    order_id: typeof row.order_id === "string" && row.order_id ? row.order_id : null,
    payment_session_status:
      typeof row.payment_session_status === "string" ? row.payment_session_status : null,
  }
}

function listingService(container: MedusaContainer): MarketplaceListingService {
  return container.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)
}

/** The Blackout checkout session that minted this cart — the Blackout-origin test. */
async function findCheckoutSession(
  container: MedusaContainer,
  cartId: string
): Promise<BlackoutCheckoutSessionLike | null> {
  const [session] = await listingService(container).listBlackoutCheckoutSessions({
    cart_id: cartId,
  })
  return (session as BlackoutCheckoutSessionLike | undefined) ?? null
}

async function listingEntitlementKind(
  container: MedusaContainer,
  listingId: string
): Promise<string | null> {
  const [listing] = await listingService(container).listCreatorListings({ id: listingId })
  return (listing as { entitlement_kind?: string | null } | undefined)?.entitlement_kind ?? null
}

async function reportPaymentFailed(
  container: MedusaContainer,
  intent: Stripe.PaymentIntent
): Promise<void> {
  const sessionId = intent?.metadata?.session_id
  if (!sessionId) {
    return
  }
  const cart = await findCartForPayment(container, { sessionId })
  if (!cart) {
    return
  }
  const session = await findCheckoutSession(container, cart.cart_id)
  if (!session?.blackout_user_id || !session.listing_id) {
    return
  }

  const priorCompleted = await listingService(container).listBlackoutCheckoutSessions(
    {
      blackout_user_id: session.blackout_user_id,
      listing_id: session.listing_id,
      status: BlackoutCheckoutSessionStatus.COMPLETED,
    },
    { take: 1 }
  )

  const args = buildPurchaseFailedArgs({
    session,
    cartId: cart.cart_id,
    cartCompleted: !!cart.cart_completed_at || !!cart.order_id,
    paymentSessionStatus: cart.payment_session_status,
    listingEntitlementKind: await listingEntitlementKind(container, session.listing_id),
    hasPriorCompletedPurchase: priorCompleted.some((s) => s.id !== session.id),
  })
  if (args) {
    await emitPurchaseFailed(container, args)
  }
}

async function reportChargeback(
  container: MedusaContainer,
  dispute: Stripe.Dispute
): Promise<void> {
  const paymentIntentId = stripeDisputePaymentIntentId(dispute)
  if (!paymentIntentId) {
    return
  }
  const cart = await findCartForPayment(container, { paymentIntentId })
  if (!cart) {
    return
  }
  const session = await findCheckoutSession(container, cart.cart_id)
  if (!session?.blackout_user_id || !session.listing_id) {
    return
  }

  const args = buildPurchaseChargebackedArgs({
    session,
    orderId: cart.order_id,
    listingEntitlementKind: await listingEntitlementKind(container, session.listing_id),
  })
  if (args) {
    await emitPurchaseChargebacked(container, args)
  }
}
