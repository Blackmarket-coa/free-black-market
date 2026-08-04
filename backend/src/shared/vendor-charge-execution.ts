import Stripe from "stripe"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { VENDOR_BILLING_MODULE } from "../modules/vendor-billing"
import type VendorBillingService from "../modules/vendor-billing/service"
import type { ChargeRecord } from "../modules/vendor-billing/service"
import {
  VendorChargeKind,
  VendorChargeStatus,
  isOutstanding,
} from "../modules/vendor-billing/charges"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"
import { grantPromotion } from "./promoted-listing-service"
import { grantAddon } from "./vendor-addons"

const log = createLogger("shared/vendor-charge-execution")

/**
 * The seam between the charge ledger and Stripe.
 *
 * The ledger (`modules/vendor-billing`) records what a vendor owes and never
 * talks to Stripe; this file is the only place a vendor charge is presented to
 * a payment rail. Kept in `shared/` because execution needs two modules the
 * ledger cannot resolve — `vendor-plan` for the seller's Stripe customer id,
 * and the promotion service for fulfilment — the same composition-point
 * pattern as `shared/platform-fee.ts`.
 *
 * **Fail-closed by explicit opt-in.** Mirroring `isAchPayoutConfigured`:
 * collection runs only when a Stripe key is present AND the operator has set
 * `VENDOR_BILLING_ENABLED=true`. Until then every charge stays `pending` —
 * recorded, visible in the vendor's balance, collectable later or out-of-band
 * — and nothing is silently debited from anyone.
 */
export function isVendorBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.VENDOR_BILLING_ENABLED === "true"
  )
}

export type ExecutionResult = {
  executed: boolean
  /** The charge's status after this attempt. */
  status: VendorChargeStatus | string
  /**
   * Why nothing was presented to Stripe, when `executed` is false.
   * `billing_not_configured` and `no_payment_method` leave the charge
   * pending; `payment_failed` marks it failed for retry.
   */
  reason?:
    | "billing_not_configured"
    | "charge_not_found"
    | "not_outstanding"
    | "no_payment_method"
    | "payment_failed"
}

/** Minimal Stripe surface, injectable for tests. */
export type StripeLike = {
  paymentIntents: {
    create: (
      params: Record<string, unknown>,
      opts: { idempotencyKey: string }
    ) => Promise<{ id: string; status: string }>
  }
  paymentMethods: {
    list: (params: {
      customer: string
      limit?: number
    }) => Promise<{ data: { id: string }[] }>
  }
  customers: {
    create: (params: Record<string, unknown>) => Promise<{ id: string }>
  }
  setupIntents: {
    create: (params: Record<string, unknown>) => Promise<{
      id: string
      client_secret: string | null
    }>
  }
}

function buildStripe(): StripeLike {
  // No pinned apiVersion: the account default applies, matching how
  // `hawala-ledger/stripe-ach.ts` constructs its client.
  return new Stripe(
    process.env.STRIPE_SECRET_KEY as string
  ) as unknown as StripeLike
}

/**
 * Present an outstanding charge to the vendor's saved payment method.
 *
 * Off-session and confirm-immediately: vendor billing is machine-initiated (a
 * renewal cron, a purchase already authorized in the panel), so there is no
 * browser to run 3DS in. A payment method that demands interactive auth fails
 * here and the charge goes to `failed` — which is the honest state, because
 * the money genuinely was not collected.
 *
 * The Stripe idempotency key reuses the charge's own ledger key, so a crash
 * between "PaymentIntent created" and "charge marked processing" cannot mint a
 * second intent on retry — Stripe returns the first one.
 *
 * Never throws. A billing failure is a state on the charge, not an exception
 * in whatever flow happened to trigger collection.
 */
export async function executeCharge(
  container: MedusaContainer,
  chargeId: string,
  deps: { stripe?: StripeLike } = {}
): Promise<ExecutionResult> {
  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)

  const charges = (await billing.listVendorCharges({
    id: chargeId,
  })) as unknown as ChargeRecord[]
  const charge = charges?.[0]
  if (!charge) return { executed: false, status: "missing", reason: "charge_not_found" }

  if (!isOutstanding(charge.status as VendorChargeStatus)) {
    return { executed: false, status: charge.status, reason: "not_outstanding" }
  }

  if (!isVendorBillingConfigured() && !deps.stripe) {
    return {
      executed: false,
      status: charge.status,
      reason: "billing_not_configured",
    }
  }

  // The Stripe customer lives on the plan assignment — the one row every
  // seller has (lazily created) and the natural home for billing identity.
  const plans = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
  const assignment = (await plans.ensureAssignment(charge.seller_id)) as {
    stripe_customer_id?: string | null
  }
  const customerId = assignment.stripe_customer_id ?? null

  if (!customerId) {
    // Recorded but uncollectable: the vendor has never saved a payment
    // method. The charge stays pending in their balance rather than failing —
    // "failed" implies an attempt was made.
    return { executed: false, status: charge.status, reason: "no_payment_method" }
  }

  const stripe = deps.stripe ?? buildStripe()

  try {
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      limit: 1,
    })
    const paymentMethod = methods.data?.[0]?.id
    if (!paymentMethod) {
      return {
        executed: false,
        status: charge.status,
        reason: "no_payment_method",
      }
    }

    const intent = await stripe.paymentIntents.create(
      {
        amount: charge.amount,
        currency: charge.currency_code,
        customer: customerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: charge.description,
        metadata: {
          type: "vendor_charge",
          charge_id: charge.id,
          seller_id: charge.seller_id,
          charge_kind: charge.kind,
        },
      },
      { idempotencyKey: `vendor-charge:${charge.idempotency_key}` }
    )

    // Card rails usually settle synchronously; ACH sits in processing for
    // days. Record whichever Stripe reports, and let the webhook finish the
    // slow path.
    const settled = intent.status === "succeeded"
    await billing.transitionCharge(
      charge.id,
      settled ? VendorChargeStatus.PAID : VendorChargeStatus.PROCESSING,
      { stripe_payment_intent_id: intent.id }
    )

    if (settled) {
      await fulfillPaidCharge(container, charge.id)
    }

    return {
      executed: true,
      status: settled ? VendorChargeStatus.PAID : VendorChargeStatus.PROCESSING,
    }
  } catch (err) {
    const reason =
      (err as { code?: string })?.code ??
      (err instanceof Error ? err.message : "unknown")
    log.warn(
      `[charge-execution] charge ${charge.id} for ${charge.seller_id} failed: ${reason}`
    )
    await billing.transitionCharge(charge.id, VendorChargeStatus.FAILED, {
      failure_reason: String(reason).slice(0, 500),
    })
    return {
      executed: false,
      status: VendorChargeStatus.FAILED,
      reason: "payment_failed",
    }
  }
}

/**
 * Deliver what a paid charge bought.
 *
 * Runs from BOTH the synchronous path (card settled immediately) and the
 * webhook (`payment_intent.succeeded`), because dev environments have no
 * webhook delivery and production cards settle before the webhook lands.
 * `metadata.fulfilled_at` is the replay guard: promotion fulfilment EXTENDS
 * the expiry, so delivering the same charge twice would hand out double time.
 * (Check-then-set on one row — a true simultaneous race is possible but needs
 * the sync path and the webhook inside the same second; the cost of losing it
 * is bounded at one extra period for one vendor.)
 *
 * Plan charges need no fulfilment: the plan transition already happened, the
 * charge only collects for it.
 */
export async function fulfillPaidCharge(
  container: MedusaContainer,
  chargeId: string
): Promise<{ fulfilled: boolean; replayed: boolean }> {
  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)
  const charges = (await billing.listVendorCharges({
    id: chargeId,
  })) as unknown as (ChargeRecord & { metadata?: Record<string, unknown> | null })[]
  const charge = charges?.[0]

  if (!charge || charge.status !== VendorChargeStatus.PAID) {
    return { fulfilled: false, replayed: false }
  }
  if (charge.metadata?.fulfilled_at) {
    return { fulfilled: false, replayed: true }
  }

  if (charge.kind === VendorChargeKind.PROMOTION) {
    const tier = (charge.metadata?.tier_code as string) ?? null
    await grantPromotion(container, {
      sellerId: charge.seller_id,
      tierCode: tier,
      reason: `purchase: charge ${charge.id}`,
    })
  }

  if (charge.kind === VendorChargeKind.ADDON) {
    const code = (charge.metadata?.addon_code as string) ?? ""
    // Same exactly-once guard as promotions: fulfilment extends the pack's
    // window, so double delivery from a webhook replay would hand out double
    // time. The `fulfilled_at` stamp above this switch is what prevents it.
    await grantAddon(container, {
      sellerId: charge.seller_id,
      code,
      reason: `purchase: charge ${charge.id}`,
    })
  }

  await billing.updateVendorCharges({
    id: charge.id,
    metadata: { ...(charge.metadata ?? {}), fulfilled_at: new Date().toISOString() },
  })

  return { fulfilled: true, replayed: false }
}

export type SetupIntentResult =
  | { available: false; reason: "billing_not_configured" }
  | {
      available: true
      client_secret: string | null
      stripe_customer_id: string
      /**
       * The Stripe publishable key the card form initializes Stripe.js with.
       * Public by design — it identifies the account, authorizes nothing — so
       * returning it here saves the panel a separate env var and keeps the
       * whole card flow driven by one backend call. Null when unset, which the
       * panel treats as "card capture unavailable".
       */
      publishable_key: string | null
    }

/** The Stripe publishable key, or null when unconfigured. */
export function vendorBillingPublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null
}

/**
 * Start saving a payment method for a vendor.
 *
 * Creates (once) and persists the vendor's Stripe customer on their plan
 * assignment, then opens a SetupIntent whose `client_secret` the panel
 * confirms with Stripe.js — card details never touch this backend. `usage:
 * "off_session"` because everything that will ever charge this method is
 * machine-initiated (renewal cron, purchase already authorized in the panel).
 *
 * The customer id is written back BEFORE the SetupIntent is created: if the
 * intent fails, the customer is reused on retry rather than leaking a new
 * Stripe customer per attempt.
 */
export async function createBillingSetupIntent(
  container: MedusaContainer,
  sellerId: string,
  deps: { stripe?: StripeLike } = {}
): Promise<SetupIntentResult> {
  if (!isVendorBillingConfigured() && !deps.stripe) {
    return { available: false, reason: "billing_not_configured" }
  }

  const stripe = deps.stripe ?? buildStripe()
  const plans = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
  const assignment = (await plans.ensureAssignment(sellerId)) as {
    id: string
    stripe_customer_id?: string | null
  }

  let customerId = assignment.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { seller_id: sellerId },
    })
    customerId = customer.id
    await plans.updateVendorPlanAssignments([
      { id: assignment.id, stripe_customer_id: customerId },
    ])
  }

  const intent = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    metadata: { seller_id: sellerId },
  })

  return {
    available: true,
    client_secret: intent.client_secret,
    stripe_customer_id: customerId,
    publishable_key: vendorBillingPublishableKey(),
  }
}

/**
 * Apply a Stripe payment_intent event to the charge it collects.
 *
 * Separated from the webhook route so it can be tested with synthetic events
 * — the route's only jobs are signature verification and handing over. Events
 * for intents this ledger does not know (ACH deposits, order payments) return
 * `ignored`, because this endpoint shares a Stripe account with the hawala
 * rails and must not touch their traffic.
 */
export async function applyVendorChargeEvent(
  container: MedusaContainer,
  event: {
    type: string
    data: {
      id: string
      metadata?: Record<string, string | undefined>
      last_payment_error?: { message?: string } | null
    }
  }
): Promise<{ handled: boolean; outcome?: string }> {
  if (event.data?.metadata?.type !== "vendor_charge") {
    return { handled: false, outcome: "ignored" }
  }

  const billing = container.resolve<VendorBillingService>(VENDOR_BILLING_MODULE)
  const charge =
    (event.data.metadata.charge_id
      ? ((await billing.listVendorCharges({
          id: event.data.metadata.charge_id,
        })) as unknown as ChargeRecord[])
      : []
    )?.[0] ?? (await billing.findByPaymentIntent(event.data.id))

  if (!charge) return { handled: false, outcome: "charge_not_found" }

  switch (event.type) {
    case "payment_intent.succeeded": {
      // An illegal move (already paid) returns null — a webhook replay, fine.
      await billing.transitionCharge(charge.id, VendorChargeStatus.PAID, {
        stripe_payment_intent_id: event.data.id,
      })
      await fulfillPaidCharge(container, charge.id)
      return { handled: true, outcome: "paid" }
    }
    case "payment_intent.payment_failed": {
      await billing.transitionCharge(charge.id, VendorChargeStatus.FAILED, {
        stripe_payment_intent_id: event.data.id,
        failure_reason:
          event.data.last_payment_error?.message?.slice(0, 500) ??
          "payment_failed",
      })
      return { handled: true, outcome: "failed" }
    }
    default:
      return { handled: false, outcome: "ignored" }
  }
}
