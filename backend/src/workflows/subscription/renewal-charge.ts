import Stripe from "stripe"
import type { BigNumberInput, MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../../shared/logger"
import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import type SubscriptionModuleService from "../../modules/subscription/service"
import type { RenewalChargeRecord } from "../../modules/subscription/service"
import type { SubscriptionInterval } from "../../modules/subscription/types"
import {
  renewalIdempotencyKey,
  renewalPeriodStart,
  toSmallestUnit,
} from "../../modules/subscription/utils/renewal-charge"

const log = createLogger("workflows/subscription/renewal-charge")

/**
 * The seam between a consumer subscription renewal and Stripe — the
 * consumer-side copy of `shared/vendor-charge-execution.ts`.
 *
 * A live renewal (FBM_SUBSCRIPTION_RENEWAL_LIVE === "1") charges the saved
 * payment method with a DIRECT PaymentIntent on the platform account:
 * off-session, confirm-immediately, automatic capture. Machine-initiated, so
 * there is no browser for 3DS; a method that demands interactive auth fails
 * here and the renewal goes to dunning, which is the honest state.
 *
 * Order of writes, per cycle — ONE PaymentIntent per cycle, its id persisted
 * before it is ever confirmed:
 *   1. the charge is RECORDED on the subscription (`metadata.renewal_charge`,
 *      status `pending`) with an idempotency key derived from the record;
 *   2. the cycle's intent is created UNCONFIRMED with that key, and its id is
 *      recorded (still `pending`) — no money can move before the id is on the
 *      row;
 *   3. that intent is confirmed off-session;
 *   4. the outcome is recorded;
 *   5. only then does the workflow complete the order and roll the period.
 *
 * Re-presentation (a later dunning retry, a crash, an overlapping run) never
 * creates a second charge for the cycle:
 *   - a cycle recorded `succeeded`, `processing` or `not_required` is not
 *     presented to Stripe again at all (`processing` is money in flight —
 *     re-presenting it after Stripe's 24-hour key retention could charge
 *     twice);
 *   - a cycle with a recorded intent id is RETRIEVED first: if it already
 *     collected, that is recorded and returned; otherwise the SAME intent is
 *     confirmed again. A PaymentIntent collects at most once, so this is safe
 *     however many days apart the retries are — which a bare idempotency key
 *     is not (Stripe keeps keys 24 hours; dunning retries are 1/3/7 days);
 *   - a crash between step 2's create and its record leaves `pending` with no
 *     id; that intent was never confirmed, so a fresh create (same key) can at
 *     worst leave an unconfirmed intent behind, never a second charge.
 * This departs from the vendor-plan precedent (`vendor-billing/charges.ts`
 * re-presents `processing` and creates with confirm=true), which has the same
 * past-24h gap.
 *
 * Fails closed: no saved payment method, a method with no Stripe customer, or
 * no Stripe key all THROW, so the job routes the renewal to dunning. A missing
 * method is never a silent free renewal.
 *
 * Key: `STRIPE_API_KEY`, the key the Medusa Stripe provider is registered with
 * (medusa-config.ts) — the account on which the customer's method was saved at
 * checkout. Vendor billing uses STRIPE_SECRET_KEY; they must name the same
 * account for this to work, which is a go-live check, not something code can
 * verify.
 *
 * Verified against node_modules only (stripe 17.7.0 types: PaymentIntent
 * create params `capture_method`, `confirm`,
 * `automatic_payment_methods.allow_redirects`, and the doc on `off_session`
 * "can only be used with confirm=true"; `paymentIntents.confirm(id, params,
 * options)` with `off_session` / `payment_method`; `paymentIntents.retrieve`;
 * the Status union; PaymentMethod `customer`).
 * Not run against Stripe: no test-mode key exists in this environment.
 */

export type RenewalChargeFailure =
  | "no_payment_method"
  | "billing_not_configured"
  | "payment_method_has_no_customer"
  | "payment_failed"

export class RenewalChargeError extends Error {
  readonly code: RenewalChargeFailure
  constructor(code: RenewalChargeFailure, message: string) {
    super(message)
    this.name = "RenewalChargeError"
    this.code = code
  }
}

/** Minimal Stripe surface, injectable for tests. */
export type RenewalStripeLike = {
  paymentMethods: {
    retrieve: (
      id: string
    ) => Promise<{ id: string; customer?: string | { id: string } | null }>
  }
  paymentIntents: {
    create: (
      params: Record<string, unknown>,
      opts: { idempotencyKey: string }
    ) => Promise<{ id: string; status: string }>
    retrieve: (id: string) => Promise<{ id: string; status: string }>
    confirm: (
      id: string,
      params: Record<string, unknown>,
      opts: { idempotencyKey: string }
    ) => Promise<{ id: string; status: string }>
  }
}

export function isRenewalChargeConfigured(): boolean {
  return Boolean(process.env.STRIPE_API_KEY)
}

function buildStripe(): RenewalStripeLike {
  return new Stripe(process.env.STRIPE_API_KEY as string) as unknown as RenewalStripeLike
}

export type RenewalChargeResult = {
  payment_intent_id: string | null
  status: RenewalChargeRecord["status"]
  idempotency_key: string
  period_start: string
  /** Smallest currency unit (integer cents for USD). */
  amount: number
  currency_code: string
  /**
   * True when this cycle was already collected (or is in flight) and Stripe
   * was not asked to charge again.
   */
  replayed: boolean
}

type SubscriptionRow = {
  id: string
  customer_id?: string | null
  interval: SubscriptionInterval
  last_order_date: Date | string
  payment_method_id?: string | null
  metadata?: Record<string, unknown> | null
}

export async function executeRenewalCharge(
  container: MedusaContainer,
  args: {
    subscription_id: string
    /** Renewal cart total, Medusa major units. */
    amount: BigNumberInput
    currency_code: string
  },
  deps: { stripe?: RenewalStripeLike; now?: Date } = {}
): Promise<RenewalChargeResult> {
  const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
  const subscription = (await service.retrieveSubscription(
    args.subscription_id
  )) as unknown as SubscriptionRow

  const periodStart = renewalPeriodStart(subscription.last_order_date, subscription.interval)
  const periodIso = periodStart.toISOString()
  const idempotencyKey = renewalIdempotencyKey({
    subscription_id: subscription.id,
    period_start: periodStart,
  })
  const currency = args.currency_code.toLowerCase()
  const amount = toSmallestUnit(args.amount, currency)
  const now = deps.now ?? new Date()

  const base = {
    period_start: periodIso,
    idempotency_key: idempotencyKey,
    amount,
    currency_code: currency,
  }

  const previous = (subscription.metadata?.renewal_charge ?? null) as
    | RenewalChargeRecord
    | null
  const samePeriod = Boolean(previous && previous.period_start === periodIso)
  if (
    previous &&
    samePeriod &&
    (previous.status === "succeeded" ||
      previous.status === "processing" ||
      previous.status === "not_required")
  ) {
    return {
      ...base,
      payment_intent_id: previous.payment_intent_id ?? null,
      status: previous.status,
      replayed: true,
    }
  }

  const record = (patch: Partial<RenewalChargeRecord> & Pick<RenewalChargeRecord, "status">) =>
    service.recordRenewalCharge(subscription.id, {
      ...base,
      payment_intent_id: null,
      failure_reason: null,
      recorded_at: now.toISOString(),
      ...patch,
    })

  if (amount <= 0) {
    await record({ status: "not_required" })
    return { ...base, payment_intent_id: null, status: "not_required", replayed: false }
  }

  // The cycle's intent, when an earlier attempt already created one.
  let intentId: string | null = samePeriod ? previous?.payment_intent_id ?? null : null

  const paymentMethod = subscription.payment_method_id ?? null
  if (!paymentMethod) {
    await record({ status: "failed", failure_reason: "no_payment_method", payment_intent_id: intentId })
    throw new RenewalChargeError(
      "no_payment_method",
      `Subscription ${subscription.id} has no saved payment method; renewal not charged`
    )
  }

  // Recorded BEFORE Stripe is called, and before the period rolls.
  await record({ status: "pending", payment_intent_id: intentId })

  if (!deps.stripe && !isRenewalChargeConfigured()) {
    await record({ status: "failed", failure_reason: "billing_not_configured", payment_intent_id: intentId })
    throw new RenewalChargeError(
      "billing_not_configured",
      "STRIPE_API_KEY is not set; live renewal cannot charge"
    )
  }

  const stripe = deps.stripe ?? buildStripe()

  let customer: string | null = null
  try {
    const method = await stripe.paymentMethods.retrieve(paymentMethod)
    customer =
      typeof method.customer === "string"
        ? method.customer
        : method.customer?.id ?? null
  } catch (err) {
    const reason = stripeReason(err)
    await record({ status: "failed", failure_reason: reason, payment_intent_id: intentId })
    throw new RenewalChargeError("payment_failed", `payment method lookup failed: ${reason}`)
  }
  if (!customer) {
    await record({
      status: "failed",
      failure_reason: "payment_method_has_no_customer",
      payment_intent_id: intentId,
    })
    throw new RenewalChargeError(
      "payment_method_has_no_customer",
      `Payment method for subscription ${subscription.id} is not attached to a Stripe customer`
    )
  }

  // Key for a NEW intent. A canceled intent (Stripe's confirmation limit)
  // cannot be confirmed again, so its replacement gets a key that names it —
  // still derived from the record, never from the attempt.
  let createKey = idempotencyKey

  if (intentId) {
    let existing: { id: string; status: string }
    try {
      existing = await stripe.paymentIntents.retrieve(intentId)
    } catch (err) {
      const reason = stripeReason(err)
      await record({ status: "failed", failure_reason: reason, payment_intent_id: intentId })
      throw new RenewalChargeError("payment_failed", `renewal intent lookup failed: ${reason}`)
    }
    const collected = collectedStatus(existing.status)
    if (collected) {
      await record({ status: collected, payment_intent_id: existing.id })
      return { ...base, payment_intent_id: existing.id, status: collected, replayed: true }
    }
    if (existing.status === "canceled") {
      createKey = `${idempotencyKey}:replaces:${existing.id}`
      intentId = null
    }
  }

  if (!intentId) {
    let created: { id: string; status: string }
    try {
      created = await stripe.paymentIntents.create(
        {
          amount,
          currency,
          customer,
          payment_method: paymentMethod,
          // Created unconfirmed so its id is on the row before any money can
          // move; confirmed off-session below. (`off_session` is only valid
          // on create together with confirm=true, so it goes on the confirm.)
          confirm: false,
          capture_method: "automatic",
          // Off-session: no customer to redirect, so never offer a
          // redirect-based method (also removes the return_url requirement
          // on confirm).
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          description: `Subscription renewal ${subscription.id}`,
          metadata: {
            type: "subscription_renewal",
            subscription_id: subscription.id,
            period_start: periodIso,
            idempotency_key: idempotencyKey,
          },
        },
        { idempotencyKey: createKey }
      )
    } catch (err) {
      const reason = stripeReason(err)
      log.warn(`[renewal-charge] ${subscription.id} ${periodIso} create failed: ${reason}`)
      await record({ status: "failed", failure_reason: reason })
      throw new RenewalChargeError("payment_failed", `renewal charge failed: ${reason}`)
    }
    intentId = created.id
    // The id is persisted BEFORE the confirm.
    await record({ status: "pending", payment_intent_id: intentId })
  }

  let intent: { id: string; status: string }
  try {
    intent = await stripe.paymentIntents.confirm(
      intentId,
      { payment_method: paymentMethod, off_session: true },
      // Per intent: a re-confirm of the same intent inside Stripe's 24-hour
      // window replays the stored outcome; a replacement intent never
      // collides with the canceled one's key.
      { idempotencyKey: `${idempotencyKey}:confirm:${intentId}` }
    )
  } catch (err) {
    const reason = stripeReason(err)
    // A confirm can be refused because the intent already collected (an
    // overlapping run, or a create replayed from Stripe's key cache with its
    // creation-time status). Read the intent before calling it a failure.
    const settled = await stripe.paymentIntents.retrieve(intentId).catch(() => null)
    const collected = settled ? collectedStatus(settled.status) : null
    if (settled && collected) {
      await record({ status: collected, payment_intent_id: settled.id })
      return { ...base, payment_intent_id: settled.id, status: collected, replayed: false }
    }
    log.warn(`[renewal-charge] ${subscription.id} ${periodIso} failed: ${reason}`)
    await record({ status: "failed", failure_reason: reason, payment_intent_id: intentId })
    throw new RenewalChargeError("payment_failed", `renewal charge failed: ${reason}`)
  }

  // Cards settle synchronously; bank debits sit in `processing` for days, as
  // in vendor billing. Anything else (requires_action, requires_payment_method)
  // means the money was not collected.
  const status: RenewalChargeRecord["status"] = collectedStatus(intent.status) ?? "failed"

  await record({
    status,
    payment_intent_id: intent.id,
    failure_reason: status === "failed" ? `intent_status:${intent.status}` : null,
  })

  if (status === "failed") {
    throw new RenewalChargeError(
      "payment_failed",
      `renewal charge not collected (intent ${intent.id} is ${intent.status})`
    )
  }

  return { ...base, payment_intent_id: intent.id, status, replayed: false }
}

/** `succeeded` / `processing` for an intent that collected (or is collecting). */
function collectedStatus(intentStatus: string): "succeeded" | "processing" | null {
  if (intentStatus === "succeeded") return "succeeded"
  if (intentStatus === "processing") return "processing"
  return null
}

function stripeReason(err: unknown): string {
  const code = (err as { code?: unknown })?.code
  if (typeof code === "string" && code) return code.slice(0, 200)
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}
