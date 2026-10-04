/**
 * The vocabulary of a Stripe *direct charge* on a connected account, in one
 * place, so the payment provider that mints one and the donation service that
 * records one cannot disagree about what "direct" means.
 *
 * Posture A (docs/POSTURE_A_COMPLIANCE.md, legal checkpoint L24): a donation is
 * collected as ONE PaymentIntent created ON the recipient org's connected
 * account — the `stripeAccount` request option, the `Stripe-Account` header —
 * so the funds settle on the org's own Stripe balance and never transit FBM's.
 * Every other Connect shape routes money through the platform first:
 *
 *   - `transfer_data`          destination charge (platform balance → transfer)
 *   - `on_behalf_of`           settlement merchant override on a platform charge
 *   - `application_fee_amount` the platform taking a cut of the charge
 *   - separate charges and transfers (`transfers.create`) — not a PaymentIntent
 *     parameter at all, so it cannot appear here; the provider simply has no
 *     code path that calls it.
 *
 * These three are refused wherever they appear in a direct-charge input, at
 * any depth, whatever the value. Null counts as absent: a PaymentIntent object
 * returned by Stripe carries `transfer_data: null` for a plain charge and that
 * is the shape being asserted, not a violation.
 */

export const FORBIDDEN_DIRECT_CHARGE_PARAMS: ReadonlySet<string> = new Set<string>([
  "transfer_data",
  "on_behalf_of",
  "application_fee_amount",
])

/** Stripe connected-account ids look like `acct_1ABC...`. */
const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/

export function isStripeAccountId(value: unknown): value is string {
  return typeof value === "string" && STRIPE_ACCOUNT_ID.test(value)
}

/**
 * Dotted paths of every forbidden parameter present (non-null, non-undefined)
 * anywhere in `input`. Empty when the input is clean.
 *
 * Walks plain objects and arrays only; a Date or a Buffer is a leaf. Cycles are
 * guarded so a hostile or accidental self-reference cannot hang a request.
 */
export function findForbiddenDirectChargeParams(input: unknown): string[] {
  const found: string[] = []
  const seen = new WeakSet<object>()

  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return
    if (seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (value instanceof Date || Buffer.isBuffer(value)) return

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      if (FORBIDDEN_DIRECT_CHARGE_PARAMS.has(key) && child !== null && child !== undefined) {
        found.push(childPath)
      }
      walk(child, childPath)
    }
  }

  walk(input, "")
  return found
}

/**
 * The server-only channel for "which connected account, for whom".
 *
 * Medusa hands a payment provider two bags: `data`, which the stock
 * `POST /store/payment-collections/:id/payment-sessions` route copies straight
 * from the request body, and `context`, which that route cannot set — the
 * workflow builds it from the customer and account holder it looked up, and
 * the types document it as "not directly provided by the user". A provider
 * that read the connected account from `data` would let any storefront caller
 * with a Connect account aim a goods payment at it. So the account is read
 * ONLY from `context[DIRECT_CHARGE_CONTEXT_KEY]`, which only server code that
 * calls `createPaymentSession` directly (the donation checkout) can populate.
 */
export const DIRECT_CHARGE_CONTEXT_KEY = "fbm_direct_charge" as const

/**
 * What a direct charge on a partner org's connected account can be for.
 *
 *   - `donation` / `donation_pledge`: the S9 donation checkout; recorded on
 *     `donation_split_record` by the donation module.
 *   - `pool_contribution`: a contribution to a nonprofit-CARRIED investment
 *     pool (docs/BMC_SURVIVAL_PROGRAMS.md Decision 7; legal checkpoint L26).
 *     Same no-custody shape — one intent ON the carrier's own account, 0 BMC
 *     fee — recorded as a `hawala_investment` row of settlement CARRIER by
 *     `recordCarrierContribution`, never on `donation_split_record` (the
 *     donation guard refuses it by kind) and never as a hawala ledger leg.
 */
export const DIRECT_CHARGE_KINDS = ["donation", "donation_pledge", "pool_contribution"] as const
export type DirectChargeKind = (typeof DIRECT_CHARGE_KINDS)[number]

export type DirectChargeContext = {
  /** The recipient org's connected account, as the server read it off `partner_org`. */
  connected_account_id: string
  /** The recipient org's key, stamped on the intent so the webhook can find it. */
  org_key: string
  kind: DirectChargeKind
  /**
   * The carried pool the contribution is for. Required for, and only for,
   * `pool_contribution`; stamped on the intent as `fbm_pool_id` so the Connect
   * webhook can find the pool's PENDING record.
   */
  pool_id?: string
}

/**
 * The marker if `context` carries a well-formed one; null otherwise. Shape
 * only — the caller decides what null means (the provider refuses).
 */
export function readDirectChargeContext(context: unknown): DirectChargeContext | null {
  if (!context || typeof context !== "object") return null
  const marker = (context as Record<string, unknown>)[DIRECT_CHARGE_CONTEXT_KEY]
  if (!marker || typeof marker !== "object") return null
  const { connected_account_id, org_key, kind, pool_id } = marker as Record<string, unknown>
  if (!isStripeAccountId(connected_account_id)) return null
  if (typeof org_key !== "string" || org_key.length === 0) return null
  if (typeof kind !== "string" || !(DIRECT_CHARGE_KINDS as readonly string[]).includes(kind)) return null
  const hasPool = typeof pool_id === "string" && pool_id.length > 0
  if (kind === "pool_contribution" && !hasPool) return null
  if (kind !== "pool_contribution" && pool_id !== undefined && pool_id !== null) return null
  return hasPool
    ? { connected_account_id, org_key, kind: kind as DirectChargeKind, pool_id: pool_id as string }
    : { connected_account_id, org_key, kind: kind as DirectChargeKind }
}

/** True for the error Stripe raises when an idempotency key is reused with different parameters. */
export function isStripeIdempotencyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { rawType?: unknown; type?: unknown }
  return e.rawType === "idempotency_error" || e.type === "StripeIdempotencyError"
}
