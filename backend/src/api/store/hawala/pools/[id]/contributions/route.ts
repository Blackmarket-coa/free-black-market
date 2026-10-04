import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService, PaymentProviderContext } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import { z } from "zod"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { CarrierRefusalError, isCarriedPool, projectPoolCarrier } from "../../../../../../modules/hawala-ledger/carrier"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../../modules/partner-directory"
import { partnerOrgCarrierRefusal } from "../../../../../../modules/partner-directory/carrier"
import type PartnerDirectoryModuleService from "../../../../../../modules/partner-directory/service"
import {
  isStripeConnectDirectConfigured,
  STRIPE_CONNECT_DIRECT_PROVIDER_ID,
} from "../../../../../../modules/stripe-connect-direct/registration"
import { actorId, forbidden } from "../../../../../../shared/community-read-access"
import { featureFlagState, PHASE0_FEATURE_FLAGS, type Phase0FeatureFlag } from "../../../../../../shared/feature-flags"
import { createLogger } from "../../../../../../shared/logger"
import { resolveTransactionPlatformFee } from "../../../../../../shared/platform-fee"
import { resolveRequestIdempotencyKey } from "../../../../../../shared/request-idempotency"
import {
  DIRECT_CHARGE_CONTEXT_KEY,
  findForbiddenDirectChargeParams,
  isStripeIdempotencyError,
  type DirectChargeContext,
} from "../../../../../../shared/stripe-direct-charge"

const log = createLogger("api/store/hawala/pools/[id]/contributions")

/**
 * POST /store/hawala/pools/:id/contributions — a contribution to a nonprofit-
 * CARRIED investment pool, paid to the carrier THROUGH FBM.
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 7 (operator, 2026-10-04); legal
 * checkpoints L26 (this IS the offering; go-live is gated on counsel), L3,
 * L24, L11 — surfaced, not resolved. The flags stay unset everywhere.
 *
 * The same no-custody shape as the S9 donation checkout, step for step:
 *
 *   1. Dark unless BOTH FF_INVESTMENT_POOLS_V1 (the `/store/hawala/pools*`
 *      matcher) and FF_NONPROFIT_PARITY_V1 (its own matcher) are on; both are
 *      re-checked here so a matcher typo cannot open the route.
 *   2. Provider not registered ⇒ 503. No fallback to a platform charge.
 *   3. The pool must exist, be CARRIED, and be accepting money: status
 *      FUNDRAISING or ACTIVE, inside its fundraising window, the amount
 *      within `minimum_investment` / `maximum_investment`. An uncarried pool
 *      is 409 `no_carrier` (its funding path is the ledger, with the flag
 *      off); a carried pool that is not open is 409 `pool_not_open`.
 *   4. The CARRIER is re-verified NOW through the partner directory (L11):
 *      published, IRS-affirmed (or coop / unincorporated), connected account
 *      present. The frozen snapshot on the pool is not enough — a revoked org
 *      must not take money. Any refusal, including a missing org or an absent
 *      account, is `forbidden()`: 403, one body. Org keys are enumerable from
 *      `/store/partners`, so a 404/403 split would say which rows exist.
 *   5. The fee rung is consulted (`kind: "pool_contribution"`, no seller) and
 *      MUST return 0 by `transaction_kind`; anything else refuses with 409 and
 *      mints nothing. BMC takes 0 because a direct charge cannot carry a
 *      platform cut without `application_fee_amount`, which L24 forbids.
 *   6. PROCESSOR FIRST: payment collection + session on the
 *      `stripe_connect_direct` provider, the carrier's connected account in
 *      the server-only session CONTEXT (`DIRECT_CHARGE_CONTEXT_KEY`) with
 *      `kind: "pool_contribution"` and the pool id. The intent is created ON
 *      the carrier's account; the funds never transit FBM's balance.
 *   7. RECORD SECOND: `recordCarrierContribution` writes a PENDING CARRIER row
 *      on `hawala_investment` keyed by the intent id — not a donation, so
 *      never `donation_split_record`; not a ledger leg, so no account and no
 *      entry. A PENDING row counts for nothing: the Connect webhook confirms
 *      it with STRIPE's amount when the intent succeeds (never the
 *      `fbm_gross_cents` metadata), cancels it on failure, and reverses it on
 *      a full refund. Totals are derived from CONFIRMED rows only.
 *   8. Idempotency as in the donation checkout: the Stripe key is derived from
 *      the record (pool, actor, amount, account, the caller's Idempotency-Key
 *      header when sent), so a retry reuses the same intent and lands on the
 *      same row; a guest without the header gets a per-request nonce.
 *      KNOWN LIMITATION (shared with the donation checkout, recorded rather
 *      than fixed here): `resolveRequestIdempotencyKey` builds a HEADER key
 *      from scope + actor + the header alone, and every guest's actor is
 *      "anonymous" — so two guests who send the SAME Idempotency-Key value on
 *      the same pool share one key: the second gets the first's intent and
 *      `client_secret` (a different amount is a 409 conflict instead). The
 *      storefront mints a fresh random UUID per submission, so this needs a
 *      leaked or deliberately reused key; binding the header to anything
 *      per-guest would need a per-guest identity the request does not carry
 *      (the nonce would defeat the retry the header exists for).
 *
 * Copy: the response states who holds the funds and that FBM takes no fee;
 * it makes no return promise beyond what the pool record states.
 */

/** Stripe's floor for a card charge is 50¢; the ceiling is a sanity bound, not policy. */
const MIN_CENTS = 50
const MAX_CENTS = 1_000_000

/** Pool statuses under which a carried pool accepts contributions. */
const OPEN_POOL_STATUSES: ReadonlySet<string> = new Set(["FUNDRAISING", "ACTIVE"])

export function carriedPoolDisclosure(carrierName: string): string {
  return `You are paying ${carrierName} directly. Free Black Market never holds these funds and takes no fee; ${carrierName} bears card processing.`
}

export const PoolContributionBody = z
  .object({
    amount_cents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
    /** Phase 1 collects in USD only; the connected accounts are US orgs. */
    currency_code: z.literal("usd").optional(),
  })
  .strict()

export type PoolContributionBody = z.infer<typeof PoolContributionBody>

export type PoolContributionResponse = {
  pool_id: string
  pool_name: string
  carrier_org_key: string
  carrier_org_name: string
  payment_collection_id: string
  payment_session_id: string
  stripe_payment_intent_id: string
  stripe_account_id: string
  /** For Stripe Elements on the storefront; the intent lives on the carrier's account. */
  client_secret: string | null
  currency_code: string
  gross_cents: number
  bmc_fee_cents: 0
  carrier_verification_status: string
  carrier_verified_as_of: string | null
  /** "Recorded, not yet counted": the webhook confirms it with the processor's amount. */
  record_status: "PENDING"
  disclosure: string
  stripe_account_hint: "pass stripe_account_id as the `stripeAccount` option when loading Stripe.js"
}

type StripeIntentLike = {
  id?: unknown
  client_secret?: unknown
} & Record<string, unknown>

function featureDisabled(res: MedusaResponse, flag: Phase0FeatureFlag): boolean {
  if (featureFlagState.isEnabled(flag)) return false
  res.status(404).json({
    type: "feature_disabled",
    message: `Feature flag ${PHASE0_FEATURE_FLAGS[flag]} is disabled`,
  })
  return true
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Why a carried pool is not taking money right now, or null when it is. */
export function poolNotOpenReason(
  pool: { status?: string | null; fundraising_start?: unknown; fundraising_end?: unknown },
  now: Date
): string | null {
  if (typeof pool.status !== "string" || !OPEN_POOL_STATUSES.has(pool.status)) return `status ${String(pool.status)}`
  const start = asDate(pool.fundraising_start)
  if (start && now < start) return "fundraising has not started"
  const end = asDate(pool.fundraising_end)
  if (end && now > end) return "fundraising has ended"
  return null
}

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (featureDisabled(res, "INVESTMENT_POOLS_V1")) return
  if (featureDisabled(res, "NONPROFIT_PARITY_V1")) return

  if (!isStripeConnectDirectConfigured()) {
    return res.status(503).json({
      type: "pool_contributions_unavailable",
      message: "Direct-charge contributions are not enabled on this deployment.",
    })
  }

  const parsed = PoolContributionBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_request",
      message: "Invalid pool contribution payload",
      errors: z.flattenError(parsed.error),
    })
  }
  const body = parsed.data
  const currency = body.currency_code ?? "usd"
  const { id: poolId } = req.params
  const amountMajor = body.amount_cents / 100

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const [pool] = await hawala.listInvestmentPools({ id: poolId })
  if (!pool) {
    return res.status(404).json({ type: "not_found", message: "Investment pool not found" })
  }
  if (!isCarriedPool(pool)) {
    return res.status(409).json({
      type: "no_carrier",
      message: "This pool has no nonprofit carrier; contributions through FBM are collected for carried pools only.",
    })
  }
  const notOpen = poolNotOpenReason(pool, new Date())
  if (notOpen !== null) {
    return res.status(409).json({ type: "pool_not_open", message: `This pool is not accepting contributions (${notOpen}).` })
  }
  const minimum = Number(pool.minimum_investment ?? 0)
  if (Number.isFinite(minimum) && amountMajor < minimum) {
    return res.status(400).json({ type: "below_minimum", message: `Minimum contribution is $${minimum.toFixed(2)}` })
  }
  const maximum = pool.maximum_investment === null || pool.maximum_investment === undefined ? null : Number(pool.maximum_investment)
  if (maximum !== null && Number.isFinite(maximum) && maximum > 0 && amountMajor > maximum) {
    return res.status(400).json({ type: "above_maximum", message: `Maximum contribution is $${maximum.toFixed(2)}` })
  }

  // The carrier NOW, not the frozen snapshot (L11): a revoked, unpublished or
  // account-less org must not take money, whatever the pool says it was.
  const carrierKey = pool.carrier_org_key as string
  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const org = await directory.getOrgByKey(carrierKey)
  const refusal = partnerOrgCarrierRefusal(org)
  if (refusal !== null || org === null) {
    // Server-side only. The response is the same 403 for every reason.
    log.warn(`[store/hawala/pools/${poolId}/contributions] refused carrier ${carrierKey}: ${refusal}`)
    return forbidden(res)
  }
  const account = org.stripe_connect_account_id as string

  const fee = await resolveTransactionPlatformFee(req.scope, { sellerId: null, kind: "pool_contribution" })
  if (fee.percent !== 0 || fee.source !== "transaction_kind") {
    log.error(`[store/hawala/pools/${poolId}/contributions] fee rung returned ${fee.percent}% from ${fee.source}; refusing to mint`)
    return res.status(409).json({
      type: "fee_not_zero",
      message: "The platform fee on a carried-pool contribution must resolve to 0 by rule; nothing was charged.",
    })
  }

  const payment = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const customerId = actorId(req)
  // A guest has no actor identity; without a header the derived key needs a
  // nonce so two strangers giving the same amount never share an intent.
  const guestNonce = customerId ? null : randomUUID()

  const { key: idempotencyKey } = resolveRequestIdempotencyKey({
    scope: `pool-contribution:${pool.id}`,
    actorId: customerId ?? "anonymous",
    headers: req.headers,
    body: req.body,
    payload: { pool_id: pool.id, amount_cents: body.amount_cents, account, guest_nonce: guestNonce },
  })

  // The server-only channel: the provider reads the connected account from
  // here and nowhere else. `PaymentProviderContext` is closed, hence the cast.
  const directCharge: DirectChargeContext = {
    connected_account_id: account,
    org_key: carrierKey,
    kind: "pool_contribution",
    pool_id: pool.id,
  }
  const sessionContext = {
    idempotency_key: idempotencyKey,
    [DIRECT_CHARGE_CONTEXT_KEY]: directCharge,
  } as PaymentProviderContext

  const major = amountMajor.toFixed(2)
  try {
    const collection = await payment.createPaymentCollections({
      currency_code: currency,
      amount: major,
      metadata: { kind: "pool_contribution", pool_id: pool.id, org_key: carrierKey },
    })

    // Processor first: this is the call that creates the PaymentIntent ON the
    // carrier's connected account.
    const session = await payment.createPaymentSession(collection.id, {
      provider_id: STRIPE_CONNECT_DIRECT_PROVIDER_ID,
      currency_code: currency,
      amount: major,
      data: {
        connected_account_id: account,
        payment_description: `Contribution to ${pool.name} (carried by ${org.name})`,
        metadata: {
          fbm_kind: "pool_contribution",
          fbm_pool_id: pool.id,
          fbm_org_key: carrierKey,
          fbm_customer_id: customerId ?? "",
          fbm_gross_cents: String(body.amount_cents),
        },
      },
      context: sessionContext,
    })

    const intent = (session.data ?? {}) as StripeIntentLike
    if (typeof intent.id !== "string" || intent.id.length === 0) {
      throw new Error(`payment session ${session.id} carries no payment intent id`)
    }
    // The provider refuses these before minting; asserting on what came back
    // is the belt and braces, on the one object that says where the money is.
    const forbiddenParams = findForbiddenDirectChargeParams(intent)
    if (forbiddenParams.length > 0) {
      log.error(`[store/hawala/pools/${poolId}/contributions] intent ${intent.id} carries ${forbiddenParams.join(", ")}; not recorded`)
      return res.status(409).json({
        type: "direct_charge_invariant",
        code: "forbidden_intent_param",
        message: "The processor returned a shape that routes funds through the platform (L24); nothing was recorded.",
      })
    }

    // Record second: a PENDING CARRIER row keyed by the intent id. The service
    // refuses an uncarried pool and writes no ledger leg; a retry that reused
    // the intent answers already_recorded and the response is the same.
    const record = await hawala.recordCarrierContribution({
      pool_id: pool.id,
      amount: amountMajor,
      carrier_reference: intent.id,
      customer_id: customerId,
      status: "PENDING",
      metadata: {
        recorded_from: "checkout",
        payment_collection_id: collection.id,
        payment_session_id: session.id,
        stripe_account_id: account,
        gross_cents: body.amount_cents,
      },
    })
    if (!record.recorded) {
      log.info(`[store/hawala/pools/${poolId}/contributions] intent ${intent.id} already recorded (${record.reason}); retry`)
    }

    const carrier = projectPoolCarrier(pool)
    const response: PoolContributionResponse = {
      pool_id: pool.id,
      pool_name: pool.name,
      carrier_org_key: carrierKey,
      carrier_org_name: org.name,
      payment_collection_id: collection.id,
      payment_session_id: session.id,
      stripe_payment_intent_id: intent.id,
      stripe_account_id: account,
      client_secret: typeof intent.client_secret === "string" ? intent.client_secret : null,
      currency_code: currency,
      gross_cents: body.amount_cents,
      bmc_fee_cents: 0,
      // What the directory says NOW (re-verified above), dated by the IRS file.
      carrier_verification_status: org.verification_status,
      carrier_verified_as_of: org.verified_as_of instanceof Date ? org.verified_as_of.toISOString() : carrier?.verified_as_of ?? null,
      record_status: "PENDING",
      disclosure: carriedPoolDisclosure(org.name),
      stripe_account_hint: "pass stripe_account_id as the `stripeAccount` option when loading Stripe.js",
    }
    return res.status(201).json(response)
  } catch (error) {
    if (error instanceof CarrierRefusalError) {
      log.error(`[store/hawala/pools/${poolId}/contributions] ${error.message}`, error.details)
      return res.status(409).json({ type: error.reason, message: error.message })
    }
    if (isStripeIdempotencyError(error)) {
      log.warn(`[store/hawala/pools/${poolId}/contributions] Stripe idempotency conflict: ${error instanceof Error ? error.message : String(error)}`)
      return res.status(409).json({
        type: "pool_contribution_idempotency_conflict",
        message: "This contribution was already started with different details; nothing was charged. Start it again.",
      })
    }
    throw error
  }
}
