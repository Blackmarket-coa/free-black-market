import Stripe from "stripe"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MathBN,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import {
  DIRECT_CHARGE_CONTEXT_KEY,
  findForbiddenDirectChargeParams,
  isStripeAccountId,
  readDirectChargeContext,
  type DirectChargeContext,
} from "../../shared/stripe-direct-charge"
import { STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER } from "./registration"
import type { PaymentProviderOptions } from "./types"

/**
 * Stripe Connect **direct charges** — a PaymentIntent created ON a connected
 * account via the `stripeAccount` request option.
 *
 * Why this exists. The stock `@medusajs/medusa/payment-stripe` provider
 * builds its intent from a fixed whitelist (`normalizePaymentIntentParameters`)
 * and calls `paymentIntents.create(params, { idempotencyKey })` with no
 * `stripeAccount` option, so a direct charge cannot be expressed through
 * session `data` at all; and `@mercurjs/payment-stripe-connect` also mints
 * plain platform intents. Neither can put a donation on the org's own account.
 *
 * Why it does not extend Medusa's `StripeBase`. That class lives in
 * `@medusajs/payment-stripe/dist/core/stripe-base`, a transitive dependency of
 * `@medusajs/medusa` that is not hoisted into this workspace and not exposed
 * by the `@medusajs/medusa/payment-stripe` entry (which exports only the
 * `ModuleProvider`). Rather than add a dependency this slice is not allowed to
 * install, it implements `AbstractPaymentProvider` directly against the
 * `stripe` SDK the backend already depends on. The surface is the same one the
 * stock provider implements; the differences are the point:
 *
 *   - every Stripe call carries `{ stripeAccount }`, so the intent, its
 *     capture, its cancellation and its refund all happen on the connected
 *     account. There is no code path that calls `transfers.create`.
 *   - `transfer_data`, `on_behalf_of` and `application_fee_amount` are refused
 *     anywhere in the input (`shared/stripe-direct-charge.ts`). Those are the
 *     shapes under which funds transit FBM's balance (L24).
 *   - the connected account is read ONLY from the session `context`, which
 *     the stock `POST /store/payment-collections/:id/payment-sessions` route
 *     cannot set (it copies the body into `data`; the workflow builds
 *     `context` itself). A session without the server-set marker is refused —
 *     never a fallback to a platform charge, and never an account a
 *     storefront caller chose. `data.connected_account_id`, if present, may
 *     only agree with it.
 *
 * The org bears Stripe's processing fee natively — that is how a direct charge
 * settles — and BMC takes 0 by the transaction-kind rung in
 * `payout-breakdown/fee-resolution.ts`. FBM writes a record
 * (`donation_split_record`) and never a balance. Connected-account webhooks
 * are signed with a Connect endpoint secret and handled by
 * `api/webhooks/stripe-connect`, not through Medusa's provider webhook path.
 *
 * Registered only by `registration.ts` (flag + explicit enable + platform
 * key). See docs/POSTURE_A_COMPLIANCE.md rule 10.
 */
class StripeConnectDirectProviderService extends AbstractPaymentProvider<PaymentProviderOptions> {
  static identifier = STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER

  protected readonly options_: PaymentProviderOptions
  protected readonly stripe_: Stripe

  static validateOptions(options: Record<string, unknown>): void {
    if (typeof options?.apiKey !== "string" || options.apiKey.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "stripe-connect-direct: `apiKey` (the platform secret key) is required"
      )
    }
  }

  constructor(cradle: Record<string, unknown>, options: PaymentProviderOptions) {
    super(cradle, options)
    this.options_ = options
    this.stripe_ = new Stripe(options.apiKey)
  }

  // ── the direct-charge guard ─────────────────────────────────────────────

  /**
   * The connected account a NEW intent is for: read from the server-set
   * `context[DIRECT_CHARGE_CONTEXT_KEY]` only. `data` is caller-writable on
   * the stock store route, so a `connected_account_id` there is at most a
   * cross-check — it must agree with the context or the session is refused.
   */
  protected requireDirectChargeContext(
    context: InitiatePaymentInput["context"],
    data: Record<string, unknown> | undefined
  ): DirectChargeContext {
    const marker = readDirectChargeContext(context)
    if (!marker) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `stripe-connect-direct: refused — the session context carries no server-set \`${DIRECT_CHARGE_CONTEXT_KEY}\` marker. This provider mints direct charges only for the donation checkout and the carried-pool contribution checkout, which name the recipient org's connected account themselves; a connected account supplied in session data is not accepted. See docs/POSTURE_A_COMPLIANCE.md rule 10.`
      )
    }
    const fromData = data?.connected_account_id
    if (fromData !== undefined && fromData !== null && fromData !== marker.connected_account_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "stripe-connect-direct: refused — session data names a different connected account than the server-set context."
      )
    }
    return marker
  }

  /**
   * The connected account an EXISTING intent lives on. Read from the session
   * data this provider itself wrote (`connected_account_id`, see `sessionData`)
   * or, failing that, from the metadata the intent was minted with. Anything
   * else throws.
   */
  protected requireConnectedAccount(data: Record<string, unknown> | undefined): string {
    const direct = data?.connected_account_id
    if (isStripeAccountId(direct)) return direct
    const fromIntent = (data?.metadata as Record<string, unknown> | undefined)?.fbm_connected_account_id
    if (isStripeAccountId(fromIntent)) return fromIntent
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "stripe-connect-direct: `connected_account_id` (acct_...) is required; this provider only acts on direct charges on a connected account and never falls back to a platform charge. See docs/POSTURE_A_COMPLIANCE.md."
    )
  }

  protected refuseForbiddenParams(input: unknown): void {
    const found = findForbiddenDirectChargeParams(input)
    if (found.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `stripe-connect-direct: refused — ${found.join(", ")} would route funds through the platform (destination charge / on_behalf_of / application fee). Direct charges only (L24). See docs/POSTURE_A_COMPLIANCE.md.`
      )
    }
  }

  // ── amounts ─────────────────────────────────────────────────────────────

  /**
   * Medusa hands amounts in major units; Stripe wants the smallest unit.
   * Integer arithmetic through `MathBN`, rounded once. Mirrors the stock
   * provider's `getSmallestUnit` for the two-decimal and zero-decimal cases.
   */
  protected toSmallestUnit(amount: BigNumberInput, currencyCode: string): number {
    const zeroDecimal = new Set([
      "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
      "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
    ])
    const threeDecimal = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"])
    const code = currencyCode.toUpperCase()
    const power = zeroDecimal.has(code) ? 0 : threeDecimal.has(code) ? 3 : 2
    const multiplier = Math.pow(10, power)
    const scaled = Math.round(new BigNumber(MathBN.mult(amount, multiplier)).numeric)
    return power === 3 ? Math.ceil(scaled / 10) * 10 : scaled
  }

  protected fromSmallestUnit(amount: number, currencyCode: string): number {
    const code = currencyCode.toUpperCase()
    const zeroDecimal = new Set([
      "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
      "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
    ])
    const threeDecimal = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"])
    const power = zeroDecimal.has(code) ? 0 : threeDecimal.has(code) ? 3 : 2
    return new BigNumber(MathBN.div(amount, Math.pow(10, power))).numeric
  }

  protected statusOf(intent: Stripe.PaymentIntent): PaymentSessionStatus {
    switch (intent.status) {
      case "requires_payment_method":
        return intent.last_payment_error ? PaymentSessionStatus.ERROR : PaymentSessionStatus.PENDING
      case "requires_confirmation":
      case "processing":
        return PaymentSessionStatus.PENDING
      case "requires_action":
        return PaymentSessionStatus.REQUIRES_MORE
      case "canceled":
        return PaymentSessionStatus.CANCELED
      case "requires_capture":
        return PaymentSessionStatus.AUTHORIZED
      case "succeeded":
        return PaymentSessionStatus.CAPTURED
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  /** The session/payment `data`: the intent plus the account it lives on. */
  protected sessionData(intent: Stripe.PaymentIntent, account: string): Record<string, unknown> {
    return { ...intent, connected_account_id: account }
  }

  protected intentId(data: Record<string, unknown> | undefined): string {
    const id = data?.id
    if (typeof id !== "string" || id.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "stripe-connect-direct: no payment intent id on the session data")
    }
    return id
  }

  // ── AbstractPaymentProvider ─────────────────────────────────────────────

  async initiatePayment({ amount, currency_code, data, context }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    this.refuseForbiddenParams(data)
    const marker = this.requireDirectChargeContext(context, data)
    const account = marker.connected_account_id

    // Every value here is derived from the record (org, kind, account) or
    // supplied by the checkout from its own body — NOT from this attempt. The
    // caller's idempotency key is derived from the record too, and Stripe
    // rejects a reused key whose parameters differ (`idempotency_error`), so
    // nothing per-attempt may enter the params. That is why Medusa's
    // `session_id` is deliberately NOT written to the intent metadata (the
    // stock provider does); the donation record keeps the session id instead.
    const metadata: Record<string, string> = {}
    for (const [k, v] of Object.entries((data?.metadata as Record<string, unknown> | undefined) ?? {})) {
      if (k === "session_id") continue
      if (v !== null && v !== undefined) metadata[k] = String(v)
    }
    // Server-set facts win over whatever the data bag said.
    metadata.fbm_kind = marker.kind
    metadata.fbm_org_key = marker.org_key
    metadata.fbm_connected_account_id = account
    // A carried-pool contribution names its pool (Decision 7); the Connect
    // webhook finds the pool's PENDING record by it. Only the marker can set
    // it, so a data-bag `fbm_pool_id` on any other kind is dropped.
    if (marker.kind === "pool_contribution") metadata.fbm_pool_id = marker.pool_id as string
    else delete metadata.fbm_pool_id

    const params: Stripe.PaymentIntentCreateParams = {
      amount: this.toSmallestUnit(amount, currency_code),
      currency: currency_code,
      metadata,
      automatic_payment_methods: { enabled: true },
      capture_method: "automatic",
    }
    if (typeof data?.payment_description === "string") params.description = data.payment_description

    // Belt and braces: the params object is built here from named fields, so
    // nothing forbidden can be in it — but the assertion is cheap and this is
    // the one line that moves money.
    this.refuseForbiddenParams(params)

    const intent = await this.stripe_.paymentIntents.create(params, {
      idempotencyKey: context?.idempotency_key,
      stripeAccount: account,
    })

    return { id: intent.id, status: this.statusOf(intent), data: this.sessionData(intent, account) }
  }

  async getPaymentStatus({ data }: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const account = this.requireConnectedAccount(data)
    const intent = await this.stripe_.paymentIntents.retrieve(this.intentId(data), {}, { stripeAccount: account })
    return { status: this.statusOf(intent), data: this.sessionData(intent, account) }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return this.getPaymentStatus(input)
  }

  async capturePayment({ data, context }: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const account = this.requireConnectedAccount(data)
    const intent = await this.stripe_.paymentIntents.capture(
      this.intentId(data),
      {},
      { idempotencyKey: context?.idempotency_key, stripeAccount: account }
    )
    return { data: this.sessionData(intent, account) }
  }

  async cancelPayment({ data, context }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    if (!data?.id) return { data }
    const account = this.requireConnectedAccount(data)
    const intent = await this.stripe_.paymentIntents.cancel(
      this.intentId(data),
      {},
      { idempotencyKey: context?.idempotency_key, stripeAccount: account }
    )
    return { data: this.sessionData(intent, account) }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input)
  }

  /**
   * A refund of a direct charge is issued ON the connected account — the org's
   * balance is debited, the donor's card credited. It is never a transfer
   * reversal and never routed through the hawala ledger's `processRefund`.
   */
  async refundPayment({ amount, data, context }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const account = this.requireConnectedAccount(data)
    const currency = typeof data?.currency === "string" ? data.currency : "usd"
    await this.stripe_.refunds.create(
      { payment_intent: this.intentId(data), amount: this.toSmallestUnit(amount, currency) },
      { idempotencyKey: context?.idempotency_key, stripeAccount: account }
    )
    return { data }
  }

  async retrievePayment({ data }: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const account = this.requireConnectedAccount(data)
    const intent = await this.stripe_.paymentIntents.retrieve(this.intentId(data), {}, { stripeAccount: account })
    const out = this.sessionData(intent, account)
    out.amount = this.fromSmallestUnit(intent.amount, intent.currency)
    return { data: out }
  }

  async updatePayment({ data, currency_code, amount, context }: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    this.refuseForbiddenParams(data)
    const account = this.requireConnectedAccount(data)
    const smallest = this.toSmallestUnit(amount, currency_code)
    const intent = await this.stripe_.paymentIntents.update(
      this.intentId(data),
      { amount: smallest },
      { idempotencyKey: context?.idempotency_key, stripeAccount: account }
    )
    return { status: this.statusOf(intent), data: this.sessionData(intent, account) }
  }

  /**
   * Connected-account events are signed with a Connect endpoint secret and
   * carry `event.account`; they are verified and applied by
   * `api/webhooks/stripe-connect/route.ts`, which writes the split record.
   * Medusa's generic provider webhook path (`/hooks/payment/...`) is not
   * wired for this provider, so it reports not-supported rather than guess.
   */
  async getWebhookActionAndData(_payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default StripeConnectDirectProviderService
