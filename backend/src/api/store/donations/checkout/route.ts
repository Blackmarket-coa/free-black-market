import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService, PaymentProviderContext } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import { z } from "zod"
import { DONATION_MODULE } from "../../../../modules/donation"
import type DonationModuleService from "../../../../modules/donation/service"
import {
  donationRecipientRefusal,
  freezeRecipientSnapshot,
  traceResolutions,
  DirectSplitViolationError,
} from "../../../../modules/donation/direct-split-guard"
import { PARTNER_DIRECTORY_MODULE } from "../../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../../modules/partner-directory/service"
import type { PartnerOrgRecord } from "../../../../modules/partner-directory/service"
import {
  isStripeConnectDirectConfigured,
  STRIPE_CONNECT_DIRECT_PROVIDER_ID,
} from "../../../../modules/stripe-connect-direct/registration"
import { actorId, forbidden } from "../../../../shared/community-read-access"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { createLogger } from "../../../../shared/logger"
import { resolveTransactionPlatformFee } from "../../../../shared/platform-fee"
import { resolveRequestIdempotencyKey } from "../../../../shared/request-idempotency"
import {
  DIRECT_CHARGE_CONTEXT_KEY,
  isStripeIdempotencyError,
  type DirectChargeContext,
} from "../../../../shared/stripe-direct-charge"

const log = createLogger("api/store/donations/checkout")

/**
 * POST /store/donations/checkout — a direct-charge donation to partner orgs.
 *
 * A SEPARATE payment collection, not a goods-cart line. Each recipient org
 * gets its own PaymentIntent, created ON that org's connected account by the
 * `stripe_connect_direct` provider (N orgs ⇒ N intents; one intent can only
 * live on one account). Nothing here touches the cart, `order.subtotal`, or
 * `subscribers/hawala-order-payment.ts`, so no ESCROW → seller leg can ever
 * record a donation. docs/POSTURE_A_COMPLIANCE.md rule 10; legal checkpoints
 * L11, L24, L25 (docs/legal/checkpoints.md) — surfaced, not resolved.
 *
 * Order of operations, which is the posture:
 *
 *   1. Flag off ⇒ 404 (the matcher in `middlewares.ts` and this handler both).
 *   2. Provider not registered ⇒ 503. No fallback to a platform charge.
 *   3. Body parsed; every recipient checked BEFORE anything is minted:
 *      published, IRS-affirmed (or coop / unincorporated — publishable only
 *      with the operator's ack already recorded), connected account present.
 *      Any refusal is `forbidden()` — 403, one body, whether the key is
 *      unknown, unpublished or unverified. Org keys are enumerable from
 *      `/store/partners`, and a 404/403 split would say which rows exist.
 *   4. The fee rung is consulted (`kind: "donation"`, no seller) and MUST
 *      return 0 by `transaction_kind`; anything else refuses with 409 and mints
 *      nothing. The rung is the rule; this is the assertion that it held.
 *   5. Per org: processor first (payment collection + session ⇒ the intent on
 *      the connected account), record second (`recordDirectSplit`, which runs
 *      the service-layer guard). The connected account travels to the
 *      provider in the session CONTEXT (`DIRECT_CHARGE_CONTEXT_KEY`), the
 *      channel the stock store payment-session route cannot write, so only
 *      this handler can say which account an intent is minted on.
 *   6. Idempotency. The Stripe key is derived from the record — actor, org,
 *      amount, campaign — and every intent parameter is derived from the same
 *      record, so a retried request reuses the same intent at Stripe (same
 *      id, same client_secret) and `recordDirectSplit` returns the existing
 *      row. A guest has no actor identity, so without an `Idempotency-Key`
 *      header a guest key carries a per-request nonce: two strangers giving
 *      the same amount to the same org must never share an intent. Guests who
 *      want retry safety send the header. A reused key with different
 *      parameters is Stripe's `idempotency_error`, answered 409.
 *
 * The org bears Stripe's processing fee natively (that is how a direct charge
 * settles); the response says so as a disclosure. BMC's fee is 0.
 */

/** Stripe's floor for a card charge is 50¢; the ceiling is a sanity bound, not policy. */
const MIN_CENTS = 50
const MAX_CENTS = 1_000_000

export const PROCESSOR_FEE_DISCLOSURE =
  "The organisation receives your donation directly on its own Stripe account and pays the card processing fee; BMC takes 0%."

const DonationLine = z
  .object({
    org_key: z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/),
    amount_cents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
    campaign_id: z.string().trim().min(1).max(128).optional(),
  })
  .strict()

export const DonationCheckoutBody = z
  .object({
    donations: z.array(DonationLine).min(1).max(10),
    /** Phase 1 collects in USD only; the connected accounts are US orgs. */
    currency_code: z.literal("usd").optional(),
  })
  .strict()

export type DonationCheckoutBody = z.infer<typeof DonationCheckoutBody>

export type DonationCheckoutLineResponse = {
  org_key: string
  org_name: string
  payment_collection_id: string
  payment_session_id: string
  stripe_payment_intent_id: string
  stripe_account_id: string
  /** For Stripe Elements on the storefront; the intent lives on the org's account. */
  client_secret: string | null
  currency_code: string
  gross_cents: number
  bmc_fee_cents: 0
  recipient_verification_status: string
  recipient_verified_as_of: string | null
}

export type DonationCheckoutResponse = {
  donations: DonationCheckoutLineResponse[]
  disclosure: string
  /** The connected account the storefront must pass to Stripe.js for each intent. */
  stripe_account_hint: "pass stripe_account_id as the `stripeAccount` option when loading Stripe.js"
}

type StripeIntentLike = {
  id?: unknown
  client_secret?: unknown
} & Record<string, unknown>

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    return res.status(404).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1} is disabled`,
    })
  }

  if (!isStripeConnectDirectConfigured()) {
    return res.status(503).json({
      type: "direct_donations_unavailable",
      message: "Direct-charge donations are not enabled on this deployment.",
    })
  }

  const parsed = DonationCheckoutBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_request",
      message: "Invalid donation checkout payload",
      errors: z.flattenError(parsed.error),
    })
  }
  const body = parsed.data
  const currency = body.currency_code ?? "usd"

  // Every resolve in this flow is traced; the service guard refuses a record
  // whose flow touched the hawala ledger.
  const flow = traceResolutions(req.scope)
  const directory = flow.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)

  // All recipients are checked before any intent exists, so an eligibility
  // refusal mints nothing for anyone. A processor or record failure on org k
  // CAN leave unconfirmed intents (and `created` rows) for orgs 1..k-1: no
  // client_secret has reached the donor, so no money moves, and an unconfirmed
  // intent expires on Stripe's side. The webhook never promotes a `created`
  // row without a `payment_intent.succeeded` for it.
  const recipients: Array<{ line: DonationCheckoutBody["donations"][number]; org: PartnerOrgRecord }> = []
  for (const line of body.donations) {
    const org = await directory.getOrgByKey(line.org_key)
    const refusal = donationRecipientRefusal(org)
    if (refusal !== null || org === null) {
      // Server-side only. The response is the same 403 for every reason.
      log.warn(`[donations/checkout] refused recipient ${line.org_key}: ${refusal}`)
      return forbidden(res)
    }
    recipients.push({ line, org })
  }

  const fee = await resolveTransactionPlatformFee(flow as unknown as Parameters<typeof resolveTransactionPlatformFee>[0], {
    sellerId: null,
    kind: "donation",
  })
  if (fee.percent !== 0 || fee.source !== "transaction_kind") {
    log.error(`[donations/checkout] fee rung returned ${fee.percent}% from ${fee.source}; refusing to mint`)
    return res.status(409).json({
      type: "donation_fee_not_zero",
      message: "The platform fee on a donation must resolve to 0 by rule; nothing was charged.",
    })
  }

  const payment = flow.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const donations = flow.resolve<DonationModuleService>(DONATION_MODULE)
  const customerId = actorId(req)
  const snapshotAt = new Date()
  // See step 6 in the header: a guest's derived key needs a nonce.
  const guestNonce = customerId ? null : randomUUID()

  const lines: DonationCheckoutLineResponse[] = []
  try {
    for (const { line, org } of recipients) {
      const account = org.stripe_connect_account_id as string
      const { key: idempotencyKey } = resolveRequestIdempotencyKey({
        scope: `donation-checkout:${line.org_key}`,
        actorId: customerId ?? "anonymous",
        headers: req.headers,
        body: req.body,
        payload: {
          org_key: line.org_key,
          amount_cents: line.amount_cents,
          campaign_id: line.campaign_id ?? null,
          account,
          guest_nonce: guestNonce,
        },
      })

      // The server-only channel: the provider reads the connected account from
      // here and nowhere else. `PaymentProviderContext` is closed, hence the cast.
      const directCharge: DirectChargeContext = {
        connected_account_id: account,
        org_key: line.org_key,
        kind: "donation",
      }
      const sessionContext = {
        idempotency_key: idempotencyKey,
        [DIRECT_CHARGE_CONTEXT_KEY]: directCharge,
      } as PaymentProviderContext

      const major = (line.amount_cents / 100).toFixed(2)
      const collection = await payment.createPaymentCollections({
        currency_code: currency,
        amount: major,
        metadata: { kind: "donation", org_key: line.org_key, campaign_id: line.campaign_id ?? null },
      })

      // Processor first: this is the call that creates the PaymentIntent ON
      // the org's connected account.
      const session = await payment.createPaymentSession(collection.id, {
        provider_id: STRIPE_CONNECT_DIRECT_PROVIDER_ID,
        currency_code: currency,
        amount: major,
        data: {
          connected_account_id: account,
          payment_description: `Donation to ${org.name}`,
          metadata: {
            fbm_kind: "donation",
            fbm_org_key: line.org_key,
            fbm_campaign_id: line.campaign_id ?? "",
            fbm_customer_id: customerId ?? "",
            fbm_gross_cents: String(line.amount_cents),
          },
        },
        context: sessionContext,
      })

      const intent = (session.data ?? {}) as StripeIntentLike
      if (typeof intent.id !== "string" || intent.id.length === 0) {
        throw new Error(`payment session ${session.id} carries no payment intent id`)
      }

      // Record second. The guard inside refuses anything that is not a
      // zero-fee direct charge on this account with a dated recipient snapshot.
      const snapshot = freezeRecipientSnapshot(org, snapshotAt)
      const record = await donations.recordDirectSplit(
        {
          stripe_payment_intent_id: intent.id,
          stripe_account_id: account,
          org_key: line.org_key,
          campaign_id: line.campaign_id ?? null,
          kind: "donation",
          currency_code: currency,
          gross_cents: line.amount_cents,
          bmc_fee_cents: 0,
          processor_fee_cents: null,
          customer_id: customerId,
          status: "created",
          metadata: { payment_collection_id: collection.id, payment_session_id: session.id },
          ...snapshot,
        },
        intent,
        { resolved_module_keys: flow.resolved }
      )

      lines.push({
        org_key: line.org_key,
        org_name: org.name,
        payment_collection_id: collection.id,
        payment_session_id: session.id,
        stripe_payment_intent_id: record.stripe_payment_intent_id,
        stripe_account_id: record.stripe_account_id,
        client_secret: typeof intent.client_secret === "string" ? intent.client_secret : null,
        currency_code: currency,
        gross_cents: line.amount_cents,
        bmc_fee_cents: 0,
        recipient_verification_status: record.recipient_verification_status,
        recipient_verified_as_of: record.recipient_verified_as_of
          ? new Date(record.recipient_verified_as_of).toISOString()
          : null,
      })
    }
  } catch (error) {
    if (error instanceof DirectSplitViolationError) {
      log.error(`[donations/checkout] ${error.message}`, error.details)
      return res.status(409).json({ type: "direct_split_invariant", code: error.code, message: error.message })
    }
    if (isStripeIdempotencyError(error)) {
      // The same record-derived key reached Stripe with different parameters.
      // Nothing new was minted; the donor retries with a fresh action.
      log.warn(`[donations/checkout] Stripe idempotency conflict: ${error instanceof Error ? error.message : String(error)}`)
      return res.status(409).json({
        type: "donation_idempotency_conflict",
        message: "This donation was already started with different details; nothing was charged. Start it again.",
      })
    }
    throw error
  }

  const response: DonationCheckoutResponse = {
    donations: lines,
    disclosure: PROCESSOR_FEE_DISCLOSURE,
    stripe_account_hint: "pass stripe_account_id as the `stripeAccount` option when loading Stripe.js",
  }
  return res.status(201).json(response)
}
