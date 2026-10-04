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
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../modules/collective-campaign"
import type CollectiveCampaignModuleService from "../../../modules/collective-campaign/service"
import { HAWALA_LEDGER_MODULE } from "../../../modules/hawala-ledger"
import { CarrierRefusalError, isCarriedPool } from "../../../modules/hawala-ledger/carrier"
import type HawalaLedgerModuleService from "../../../modules/hawala-ledger/service"
import { partnerOrgCarrierRefusal } from "../../../modules/partner-directory/carrier"
import { STRIPE_CONNECT_WEBHOOK_SECRET_ENV } from "../../../modules/stripe-connect-direct/registration"
import { findForbiddenDirectChargeParams, isStripeAccountId } from "../../../shared/stripe-direct-charge"
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
 *
 * Shared-goal Coalition campaigns (Phase 1 item 3): when the record carries a
 * `campaign_id` and this event is the one that moves it INTO `succeeded`, the
 * gross is reported to `recordParticipantContribution` on the collective-
 * campaign module for the participant whose `partner_org_key` is the record's
 * `org_key`, keyed by the intent id. That is the ONLY money path a shared goal
 * has — a running total of what the processor did on the org's own account,
 * never a backing, never the campaign escrow. Exactly once per intent, and not
 * only for serial deliveries: the `enteredSucceeded` gate below is a per-process
 * optimisation (it spares the module a call on a replay), while the guarantee
 * is the campaign module's own `collective_campaign_contribution` row under a
 * DB unique index on (campaign, intent) — two concurrent deliveries of the same
 * success both reach the module and exactly one is counted; the other is
 * `already_recorded`. When the record moves to `refunded` (a FULL refund; a
 * partial one keeps the status) the same intent is reversed, so the public
 * totals stop overstating. A failure to report is logged and surfaced as
 * `contribution: "failed"` on a 200: the split record is already written and a
 * Stripe retry would land on it as "unchanged", so a 5xx could not repair it.
 *
 * Carried-pool contributions (Phase 1b, Decision 7; L26): an intent whose
 * `metadata.fbm_kind` is `pool_contribution` is branched BEFORE the donation
 * lookup and never touches the donation module — the donation path below is
 * byte-identical for every other event. The pool is read from the hawala
 * ledger module (resolved through the same traced flow; no ledger leg is ever
 * written). `event.account` must be the connected account the money went to,
 * else the event is acknowledged and ignored (`ignored_account_mismatch`) —
 * intent metadata is writable by whoever holds the connected account, so
 * neither the pool nor the amount is taken on its word: for an intent the
 * checkout recorded, the account it minted the intent on (stamped
 * server-side on the row); otherwise the carrier's account in the directory
 * NOW. Then, by intent id: `payment_intent.succeeded` confirms the PENDING row
 * with STRIPE's amount (or, when no row exists, creates it CONFIRMED from the
 * metadata + Stripe's amount — only while FF_INVESTMENT_POOLS_V1 is on and
 * only for an org that is an eligible carrier now);
 * `payment_intent.payment_failed` cancels it; a FULL `charge.refunded` closes
 * the row for good — confirmed or not yet, since Stripe does not order events
 * and a success can arrive after its refund. Exactly-once comes from the
 * (pool_id, carrier_reference) unique index and conditional status
 * transitions — a replay on a CONFIRMED or reversed row is `unchanged`, and
 * two racing events cannot both win — and the totals are derived from
 * CONFIRMED, unreversed rows, so even a concurrent double confirm counts once.
 */

export type StripeConnectWebhookOutcome =
  | "ignored_no_account"
  | "ignored_event_type"
  | "ignored_not_donation"
  | "ignored_unknown_org"
  | "ignored_account_mismatch"
  | "ignored_recipient_ineligible"
  | "ignored_unknown_intent"
  | "ignored_unknown_pool"
  | "ignored_pool_not_carried"
  | "ignored_feature_disabled"
  | "ignored_currency"
  | "refused_forbidden_intent_param"
  | "created"
  | "updated"
  | "unchanged"

/**
 * What happened to the campaign's participant totals for this event:
 * on a success `recorded` | `already_recorded` | `no_participant` |
 * `campaign_closed`; on a full refund `reversed` | `already_reversed` |
 * `not_recorded`; `failed` when the module threw or could not be resolved.
 */
export type StripeConnectContributionOutcome =
  | "recorded"
  | "already_recorded"
  | "no_participant"
  | "campaign_closed"
  | "reversed"
  | "already_reversed"
  | "not_recorded"
  | "failed"

export type StripeConnectWebhookResult = {
  outcome: StripeConnectWebhookOutcome
  intent_id?: string
  contribution?: StripeConnectContributionOutcome
  /** Set when the event described a carried-pool contribution rather than a donation. */
  kind?: "pool_contribution"
  pool_id?: string
}

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

type StripeMeta = Record<string, string | undefined>

/**
 * The `fbm_*` metadata the checkout stamped, as the event carries it. A
 * PaymentIntent carries its own; a Charge carries the intent's metadata as
 * Stripe copied it at creation, or the expanded intent's when the payload
 * expanded it. Empty when neither is present.
 */
function directChargeMetadata(intent: Stripe.PaymentIntent | null, charge: Stripe.Charge | null): StripeMeta {
  const fromIntent = intent?.metadata as StripeMeta | undefined
  if (fromIntent && Object.keys(fromIntent).length > 0) return fromIntent
  const expanded = charge && typeof charge.payment_intent === "object" && charge.payment_intent ? (charge.payment_intent.metadata as StripeMeta | undefined) : undefined
  if (expanded && Object.keys(expanded).length > 0) return expanded
  return (charge?.metadata as StripeMeta | undefined) ?? {}
}

/**
 * The carried-pool branch (Decision 7). Reached only for an intent whose
 * metadata says `pool_contribution`; the donation module is never resolved
 * here and the hawala ledger is read, never written to as a ledger leg.
 */
async function applyPoolContributionEvent(
  flow: Scope,
  input: {
    account: string
    intentId: string
    status: "succeeded" | "failed" | "refunded"
    intent: Stripe.PaymentIntent
    meta: StripeMeta
    fullRefund: boolean
  }
): Promise<StripeConnectWebhookResult> {
  const { account, intentId, status, intent, meta } = input
  const kind = "pool_contribution" as const
  const poolId = meta.fbm_pool_id
  if (!poolId) return { outcome: "ignored_unknown_pool", intent_id: intentId, kind }

  // A direct charge carries none of these; an intent that does was not minted
  // the way this ledger records. Refused loudly, recorded never.
  const forbidden = findForbiddenDirectChargeParams(intent)
  if (forbidden.length > 0) {
    log.error(`Connect webhook: pool contribution intent ${intentId} carries ${forbidden.join(", ")}; refused (L24)`)
    return { outcome: "refused_forbidden_intent_param", intent_id: intentId, kind, pool_id: poolId }
  }

  const hawala = flow.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const [pool] = await hawala.listInvestmentPools({ id: poolId })
  if (!pool) return { outcome: "ignored_unknown_pool", intent_id: intentId, kind, pool_id: poolId }
  if (!isCarriedPool(pool)) return { outcome: "ignored_pool_not_carried", intent_id: intentId, kind, pool_id: poolId }

  // Which connected account must this event come from? For an intent the
  // checkout recorded, the account it MINTED the intent on — written
  // server-side into the row's metadata from the directory at that moment,
  // never from Stripe metadata. That is where the money went, so a carrier
  // that later rotates its connected account does not orphan a payment made
  // before the rotation. With no row (or a row without that stamp, e.g. an
  // admin record), the carrier's account in the directory NOW: the pool
  // stores the carrier's presence, never its account id (by design).
  const [row] = await hawala.listInvestments({ pool_id: poolId, carrier_reference: intentId, settlement: "CARRIER" })
  const rowMeta = (row?.metadata ?? null) as Record<string, unknown> | null
  const mintedOn = typeof rowMeta?.stripe_account_id === "string" && isStripeAccountId(rowMeta.stripe_account_id) ? rowMeta.stripe_account_id : null
  let org: Awaited<ReturnType<PartnerDirectoryModuleService["getOrgByKey"]>> = null
  const directoryOrg = async () => {
    if (org) return org
    const directory = flow.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
    org = await directory.getOrgByKey(pool.carrier_org_key as string)
    return org
  }
  const expectedAccount = mintedOn ?? (await directoryOrg())?.stripe_connect_account_id ?? null
  if (expectedAccount === null || expectedAccount !== account) {
    log.warn(`Connect webhook: intent ${intentId} on ${account} names pool ${poolId} carried by ${String(pool.carrier_org_key)}, but ${mintedOn ? `the intent was minted on ${mintedOn}` : "the carrier's connected account in the directory differs"}; ignored`)
    return { outcome: "ignored_account_mismatch", intent_id: intentId, kind, pool_id: poolId }
  }

  const base = { intent_id: intentId, kind, pool_id: poolId }
  switch (status) {
    case "succeeded": {
      // Phase 1 collects in USD only; the table is in major units of it.
      if (typeof intent.currency !== "string" || intent.currency.toLowerCase() !== "usd" || !Number.isInteger(intent.amount)) {
        log.warn(`Connect webhook: pool contribution intent ${intentId} is ${String(intent.currency)} ${String(intent.amount)}; not recorded`)
        return { outcome: "ignored_currency", ...base }
      }
      // Stripe's figure, not the metadata's: the processor is the statement.
      const amountMajor = intent.amount / 100
      const customerId = meta.fbm_customer_id ? meta.fbm_customer_id : null
      const confirmed = await hawala.confirmCarrierContribution(poolId, intentId, {
        amount_from_processor: amountMajor,
        customer_id: customerId,
        metadata: { confirmed_from: "webhook", stripe_account_id: account },
      })
      if (confirmed.confirmed) return { outcome: "updated", ...base }
      if (confirmed.reason !== "not_recorded") return { outcome: "unchanged", ...base }
      // The checkout minted the intent but the record never landed (or this
      // intent was minted elsewhere on the carrier's account). Back-fill from
      // the metadata + Stripe's amount, as the donation path does — but only
      // while the pool offering itself is on (a dark offering creates no new
      // records from carrier-written metadata) and only for an org that
      // would be accepted as a carrier today.
      if (!featureFlagState.isEnabled("INVESTMENT_POOLS_V1")) {
        log.warn(`Connect webhook: intent ${intentId} names pool ${poolId} but ${PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1} is off; not back-filled`)
        return { outcome: "ignored_feature_disabled", ...base }
      }
      const carrierOrg = await directoryOrg()
      const refusal = partnerOrgCarrierRefusal(carrierOrg)
      if (refusal !== null || carrierOrg === null) {
        log.warn(`Connect webhook: intent ${intentId} names pool ${poolId} whose carrier ${String(pool.carrier_org_key)} is not eligible now (${refusal}); not recorded`)
        return { outcome: "ignored_recipient_ineligible", ...base }
      }
      const recorded = await hawala.recordCarrierContribution({
        pool_id: poolId,
        amount: amountMajor,
        carrier_reference: intentId,
        customer_id: customerId,
        status: "CONFIRMED",
        metadata: { recorded_from: "webhook", stripe_account_id: account },
      })
      return { outcome: recorded.recorded ? "created" : "unchanged", ...base }
    }
    case "failed": {
      const failed = await hawala.failCarrierContribution(poolId, intentId)
      if (failed.failed) return { outcome: "updated", ...base }
      if (failed.reason === "not_recorded") return { outcome: "ignored_unknown_intent", ...base }
      return { outcome: "unchanged", ...base }
    }
    case "refunded": {
      // A partial refund leaves a confirmed contribution counted; only a full
      // one reverses it. There is no partial figure to record on the row. A
      // full refund closes the row whatever its status — even one whose
      // success has not arrived yet — so a later success cannot count it.
      if (!input.fullRefund) return { outcome: "unchanged", ...base }
      const reversed = await hawala.reverseCarrierContribution(poolId, intentId)
      if (reversed.reversed) return { outcome: "updated", ...base }
      if (reversed.reason === "not_recorded") return { outcome: "ignored_unknown_intent", ...base }
      return { outcome: "unchanged", ...base }
    }
  }
}

export async function applyStripeConnectEvent(scope: Scope, event: Stripe.Event): Promise<StripeConnectWebhookResult> {
  if (!isStripeAccountId(event.account)) return { outcome: "ignored_no_account" }
  const account = event.account

  const flow = traceResolutions(scope)

  let intent: Stripe.PaymentIntent | null = null
  let refundCharge: Stripe.Charge | null = null
  let intentId: string | null = null
  let status: "succeeded" | "failed" | "refunded"
  let processorFee: number | null = null
  let refundedCents: number | null = null
  let fullRefund = false

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
      refundCharge = charge
      intentId = intentIdFromCharge(charge)
      if (!intentId) return { outcome: "ignored_event_type" }
      status = "refunded"
      processorFee = feeFromBalanceTransaction(charge.balance_transaction)
      refundedCents = Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null
      fullRefund = charge.refunded === true || (Number.isInteger(charge.amount) && refundedCents !== null && refundedCents >= charge.amount)
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

  // Carried-pool contributions branch here, before the donation lookup, so the
  // donation path below never learns they exist (Decision 7).
  const meta = directChargeMetadata(intent, refundCharge)
  if (meta.fbm_kind === "pool_contribution") {
    return applyPoolContributionEvent(flow, { account, intentId, status, intent: intent as Stripe.PaymentIntent, meta, fullRefund })
  }

  const donations = flow.resolve<DonationModuleService>(DONATION_MODULE)
  const existing = await donations.getDirectSplitByIntentId(intentId)
  // Snapshot the status as a primitive before the write: whether the service
  // hands back the same object or a copy must not decide "entered succeeded".
  const priorStatus = existing?.status ?? null

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
  if (result.outcome === "ignored_unknown_intent") {
    return { outcome: result.outcome, intent_id: intentId }
  }

  // The record moved INTO succeeded (count) or INTO refunded (reverse) on this
  // event — not a replay, not a fee-only update — and names a campaign.
  const record = result.record
  if (!record.campaign_id || result.outcome === "unchanged") {
    return { outcome: result.outcome, intent_id: intentId }
  }
  const enteredSucceeded = record.status === "succeeded" && priorStatus !== "succeeded"
  const enteredRefunded = record.status === "refunded" && priorStatus !== "refunded"
  if (!enteredSucceeded && !enteredRefunded) {
    return { outcome: result.outcome, intent_id: intentId }
  }

  let contribution: StripeConnectContributionOutcome
  try {
    const campaigns = flow.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    if (enteredSucceeded) {
      const reported = await campaigns.recordParticipantContribution({
        campaign_id: record.campaign_id,
        partner_org_key: record.org_key,
        amount_cents: Number(record.gross_cents),
        stripe_payment_intent_id: intentId,
      })
      contribution = reported.recorded ? "recorded" : reported.reason
      if (!reported.recorded) {
        log.warn(`Connect webhook: intent ${intentId} on campaign ${record.campaign_id} (org ${record.org_key}) not counted: ${reported.reason}`)
      }
    } else {
      const reversed = await campaigns.reverseParticipantContribution({
        campaign_id: record.campaign_id,
        stripe_payment_intent_id: intentId,
      })
      contribution = reversed.reversed ? "reversed" : reversed.reason
    }
  } catch (error) {
    contribution = "failed"
    log.error(`Connect webhook: contribution for intent ${intentId} on campaign ${record.campaign_id} not ${enteredSucceeded ? "recorded" : "reversed"}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { outcome: result.outcome, intent_id: intentId, contribution }
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
    if (error instanceof CarrierRefusalError) {
      // Same shape for the carried-pool rule: the service refused to record.
      log.error(`Connect webhook refused by the pool carrier rule: ${error.message}`, error.details)
      return res.status(200).json({ received: true, outcome: "refused", code: error.reason })
    }
    log.error(`Connect webhook failed: ${error instanceof Error ? error.message : String(error)}`)
    return res.status(500).json({ error: "Webhook processing failed" })
  }
}
