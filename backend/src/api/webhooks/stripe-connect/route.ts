import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import Stripe from "stripe"
import { DONATION_MODULE } from "../../../modules/donation"
import type DonationModuleService from "../../../modules/donation/service"
import type { RecordDirectSplitInput } from "../../../modules/donation/service"
import {
  DirectSplitViolationError,
  donationRecipientRefusal,
  freezeRecipientSnapshot,
  traceResolutions,
} from "../../../modules/donation/direct-split-guard"
import { DONATION_SPLIT_KINDS, type DonationSplitKind } from "../../../modules/donation/models/donation-split-record"
import { PARTNER_DIRECTORY_MODULE } from "../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../modules/partner-directory/service"
import { STRIPE_CONNECT_WEBHOOK_SECRET_ENV } from "../../../modules/stripe-connect-direct/registration"
import { isStripeAccountId } from "../../../shared/stripe-direct-charge"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import { createLogger } from "../../../shared/logger"

const log = createLogger("api/webhooks/stripe-connect")

/**
 * POST /webhooks/stripe-connect — connected-account events for direct-charge
 * donations (docs/POSTURE_A_COMPLIANCE.md rule 10).
 *
 * A Connect webhook endpoint ("listen to events on connected accounts") is
 * signed with its OWN secret and every event carries `event.account`. The
 * hawala webhook (`/webhooks/hawala/stripe`) verifies against
 * `STRIPE_WEBHOOK_SECRET` and knows nothing of `event.account`, so these
 * events need their own door: `STRIPE_CONNECT_WEBHOOK_SECRET`. Unset ⇒ 503
 * and nothing is read — a webhook that cannot be verified is not a webhook.
 *
 * Dark with FF_NONPROFIT_PARITY_V1 off (404 before the body is read, like
 * every other route on this path): the secret alone does not open the door.
 *
 * Handled, by intent id, idempotently (a re-delivery is "unchanged"):
 *   - `payment_intent.succeeded`      ⇒ status `succeeded`
 *   - `payment_intent.payment_failed` ⇒ status `failed`
 *   - `charge.refunded`               ⇒ `refunded_cents` from
 *     `charge.amount_refunded`; status `refunded` only when that covers the
 *     gross — a partial refund leaves the status and records the amount.
 * Everything without `event.account` is acknowledged and ignored: a platform
 * event at this door is a configuration mistake, not a donation.
 *
 * An intent this ledger never recorded is back-filled from a success ONLY when
 * `event.account` IS the connected account of the org the intent names and
 * that org passes `donationRecipientRefusal` now. Intent metadata is writable
 * by whoever holds the connected account — every vendor has one — so neither
 * the org nor the amount is taken on its word: the account must match the
 * directory and the gross is Stripe's `amount`, never `metadata.fbm_gross_cents`.
 *
 * Processor first, record second: Stripe is the statement of what happened
 * on the org's account, and `applyDirectSplitProcessorEvent` records it under
 * the same service-layer guard the checkout used. No hawala module is ever
 * resolved here, and the trace proves it to the guard.
 *
 * The processor fee is read only when the payload carries an expanded balance
 * transaction; it is display data on the org's own account, never a transfer.
 */

export type StripeConnectWebhookOutcome =
  | "ignored_no_account"
  | "ignored_event_type"
  | "ignored_not_donation"
  | "ignored_unknown_org"
  | "ignored_account_mismatch"
  | "ignored_recipient_ineligible"
  | "ignored_unknown_intent"
  | "created"
  | "updated"
  | "unchanged"

export type StripeConnectWebhookResult = { outcome: StripeConnectWebhookOutcome; intent_id?: string }

type Scope = { resolve: <T = unknown>(key: string) => T }

/** Verify a Connect webhook payload. Throws Stripe's signature error on a bad header. */
export function verifyStripeConnectEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret)
}

function feeFromBalanceTransaction(bt: unknown): number | null {
  if (!bt || typeof bt !== "object") return null
  const fee = (bt as { fee?: unknown }).fee
  return typeof fee === "number" && Number.isInteger(fee) ? fee : null
}

function intentIdFromCharge(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent
  if (typeof pi === "string") return pi
  if (pi && typeof pi === "object" && typeof pi.id === "string") return pi.id
  return null
}

type FallbackIgnored = "ignored_not_donation" | "ignored_unknown_org" | "ignored_account_mismatch" | "ignored_recipient_ineligible"

/**
 * Build what a fresh record would say from the intent's own metadata (what
 * the checkout stamped) plus the org as it stands now. Ignored, never
 * guessed, when the intent does not describe a donation, the org is unknown,
 * the event's account is not that org's connected account, or the org would
 * not be accepted as a recipient today. The amount is Stripe's.
 */
async function fallbackFromIntent(
  flow: Scope,
  intent: Stripe.PaymentIntent,
  account: string
): Promise<{ fallback: RecordDirectSplitInput } | { ignored: FallbackIgnored }> {
  const meta = (intent.metadata ?? {}) as Record<string, string | undefined>
  const kind = meta.fbm_kind
  const orgKey = meta.fbm_org_key
  if (!kind || !(DONATION_SPLIT_KINDS as readonly string[]).includes(kind) || !orgKey) {
    return { ignored: "ignored_not_donation" }
  }
  const directory = flow.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const org = await directory.getOrgByKey(orgKey)
  if (!org) return { ignored: "ignored_unknown_org" }
  if (org.stripe_connect_account_id !== account) {
    log.warn(`Connect webhook: intent ${intent.id} on ${account} names org ${orgKey}, whose connected account differs; not recorded`)
    return { ignored: "ignored_account_mismatch" }
  }
  const refusal = donationRecipientRefusal(org)
  if (refusal !== null) {
    log.warn(`Connect webhook: intent ${intent.id} names org ${orgKey}, which is not an eligible recipient now (${refusal}); not recorded`)
    return { ignored: "ignored_recipient_ineligible" }
  }

  return {
    fallback: {
      stripe_payment_intent_id: intent.id,
      stripe_account_id: account,
      org_key: orgKey,
      campaign_id: meta.fbm_campaign_id ? meta.fbm_campaign_id : null,
      kind: kind as DonationSplitKind,
      currency_code: intent.currency,
      // Stripe's figure, not the metadata's: the processor is the statement.
      gross_cents: intent.amount,
      bmc_fee_cents: 0,
      customer_id: meta.fbm_customer_id ? meta.fbm_customer_id : null,
      metadata: { recorded_from: "webhook" },
      ...freezeRecipientSnapshot(org, new Date()),
    },
  }
}

export async function applyStripeConnectEvent(scope: Scope, event: Stripe.Event): Promise<StripeConnectWebhookResult> {
  if (!isStripeAccountId(event.account)) return { outcome: "ignored_no_account" }
  const account = event.account

  const flow = traceResolutions(scope)

  let intent: Stripe.PaymentIntent | null = null
  let intentId: string | null = null
  let status: "succeeded" | "failed" | "refunded"
  let processorFee: number | null = null
  let refundedCents: number | null = null

  switch (event.type) {
    case "payment_intent.succeeded": {
      intent = event.data.object
      intentId = intent.id
      status = "succeeded"
      const charge = intent.latest_charge
      if (charge && typeof charge === "object") processorFee = feeFromBalanceTransaction(charge.balance_transaction)
      break
    }
    case "payment_intent.payment_failed": {
      intent = event.data.object
      intentId = intent.id
      status = "failed"
      break
    }
    case "charge.refunded": {
      const charge = event.data.object
      intentId = intentIdFromCharge(charge)
      if (!intentId) return { outcome: "ignored_event_type" }
      status = "refunded"
      processorFee = feeFromBalanceTransaction(charge.balance_transaction)
      refundedCents = Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null
      // The guard inspects the intent for forbidden params; a charge object
      // carries the same three fields when they were used.
      intent = (typeof charge.payment_intent === "object" && charge.payment_intent
        ? charge.payment_intent
        : ({ id: intentId, transfer_data: charge.transfer_data, on_behalf_of: charge.on_behalf_of, application_fee_amount: charge.application_fee_amount } as unknown)) as Stripe.PaymentIntent
      break
    }
    default:
      return { outcome: "ignored_event_type" }
  }

  const donations = flow.resolve<DonationModuleService>(DONATION_MODULE)
  const existing = await donations.getDirectSplitByIntentId(intentId)

  let fallback: RecordDirectSplitInput | undefined
  if (!existing) {
    if (event.type !== "payment_intent.succeeded") {
      // Only a success can create a record from scratch; a failure or refund
      // of an intent we never recorded is noise, not a donation.
      return { outcome: "ignored_unknown_intent", intent_id: intentId }
    }
    const built = await fallbackFromIntent(flow, intent as Stripe.PaymentIntent, account)
    if ("ignored" in built) return { outcome: built.ignored, intent_id: intentId }
    fallback = built.fallback
  }

  const result = await donations.applyDirectSplitProcessorEvent({
    stripe_payment_intent_id: intentId,
    stripe_account_id: account,
    event: status,
    processor_fee_cents: processorFee,
    refunded_cents: refundedCents,
    intent: (intent ?? {}) as unknown as Record<string, unknown>,
    flow: { resolved_module_keys: flow.resolved },
    fallback,
  })
  return { outcome: result.outcome, intent_id: intentId }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    return res.status(404).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1} is disabled`,
    })
  }

  const secret = process.env[STRIPE_CONNECT_WEBHOOK_SECRET_ENV]
  if (!secret) {
    return res.status(503).json({ type: "webhook_not_configured", message: `${STRIPE_CONNECT_WEBHOOK_SECRET_ENV} is not set` })
  }

  const signature = req.headers["stripe-signature"]
  if (typeof signature !== "string" || signature.length === 0) {
    return res.status(400).json({ error: "Missing Stripe signature" })
  }

  const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    // Without the raw bytes, constructEvent verifies nothing.
    log.error("Connect webhook raw body missing — check preserveRawBody in middlewares.ts")
    return res.status(400).json({ error: "Invalid request body format" })
  }

  let event: Stripe.Event
  try {
    event = verifyStripeConnectEvent(rawBody, signature, secret)
  } catch (error) {
    log.warn(`Connect webhook signature rejected: ${error instanceof Error ? error.message : String(error)}`)
    return res.status(400).json({ error: "Webhook verification failed" })
  }

  try {
    const result = await applyStripeConnectEvent(req.scope, event)
    log.info(`Connect webhook ${event.type} on ${event.account ?? "(no account)"} -> ${result.outcome}`)
    // 200 for ignored events too — a non-2xx makes Stripe retry traffic that
    // was never ours to handle.
    return res.status(200).json({ received: true, ...result })
  } catch (error) {
    if (error instanceof DirectSplitViolationError) {
      // A violation is a refusal to record, loudly, and a 2xx so Stripe does
      // not retry into the same wall; the log is the alarm.
      log.error(`Connect webhook refused by the direct-split guard: ${error.message}`, error.details)
      return res.status(200).json({ received: true, outcome: "refused", code: error.code })
    }
    log.error(`Connect webhook failed: ${error instanceof Error ? error.message : String(error)}`)
    return res.status(500).json({ error: "Webhook processing failed" })
  }
}
