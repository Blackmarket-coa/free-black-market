/**
 * Coalition Credits at checkout — the reservation lifecycle.
 *
 * `docs/POSTURE_A_COMPLIANCE.md` claimed this existed for a long time before
 * anyone checked; `docs/CCR_HRS_IGNITION.md` §3 and `GIFT_ECONOMY_REUSE_MAP.md`
 * each found independently that it did not. `CART` has been a blessed
 * purchase-context in `posture-a-guard.ts` since that file was written,
 * precisely so a cart-time credit reservation could clear the closed-loop
 * guard, and nothing ever posted one. This module is that missing producer.
 *
 * ## Credits are tender, not a discount
 *
 * The obvious implementation — override line-item `unit_price`, the way
 * `lib/wholesale-pricing.ts` does for tier discounts — is the wrong shape here.
 * A discount reduces what the VENDOR is paid. A credit must not: the vendor
 * sold goods and is owed the full price. Credits reduce what the BUYER pays in
 * cash, and the difference is carried by the platform, which is what makes an
 * outstanding credit a real liability rather than free money.
 *
 * So the split is:
 *
 *   vendor gross        unchanged
 *   buyer cash due      subtotal − credit value
 *   platform carries    credit value (from the issuer's backing)
 *
 * ## Lifecycle
 *
 *   apply    buyer CCR wallet → CCR cart escrow   reference_type CART
 *   settle   cart escrow      → CCR issuer        credits are extinguished
 *   release  cart escrow      → buyer CCR wallet  cart abandoned or reduced
 *
 * Settle burns rather than paying anyone: the credit's cash counterpart moves
 * on the USD rail in the normal order settlement. Burning here is what stops
 * the same credit being spent twice.
 *
 * ## Units
 *
 * Credits are whole units on the CCR rail (`lib/creator-credits.ts` — the
 * XP conversion mints whole credits, floor semantics, no fractional blocks).
 * Cash is integer minor units. Every function here is integer-only: the
 * fractional-vs-rounded mismatch between `hawala-order-payment.ts` and
 * `payout-breakdown/service.ts` is exactly the defect class this avoids.
 */

/**
 * Operator-set worth of one credit, in cents. There is deliberately no
 * default: a credit's cash value is monetary policy, not a constant an
 * engineer picks. Unset ⇒ the feature is off and every quote returns zero,
 * which is the same fail-safe posture as an unmapped `CANOPY_FBM_LISTING_IDS`
 * plan returning 503 rather than guessing a price.
 */
export const CCR_CENTS_PER_CREDIT_ENV = "FBM_CCR_CENTS_PER_CREDIT"

/**
 * Cart-metadata key holding the credits currently reserved against a cart.
 * Read by the completion guard, so it must be the one name both sides use.
 *
 * Cart metadata is buyer-writable, which `lib/wholesale-pricing.ts` learned the
 * hard way — it writes its price stash there but refuses to READ it as a
 * pricing input, because a hostile client could poison the base. The same rule
 * applies here: this value is a HINT for the guard and the UI, never the
 * authority for how many credits moved. The ledger is that authority, and the
 * guard's only use of this key is to refuse completion — a buyer who forges it
 * upward blocks their own checkout, and one who forges it to zero still cannot
 * spend credits they never reserved, because the reservation is a ledger entry
 * they cannot write.
 */
export const CCR_RESERVATION_METADATA_KEY = "ccr_credits_reserved"

/** Dark-launch gate, mirroring FBM_CREATOR_CREDITS_LIVE / FBM_CAMPAIGN_ESCROW_LIVE. */
export const CCR_CHECKOUT_FLAG = "FBM_CCR_CHECKOUT_LIVE"

export function isCcrCheckoutLive(): boolean {
  return process.env[CCR_CHECKOUT_FLAG] === "1"
}

/**
 * Cents per credit, or null when unconfigured or invalid. Invalid values fall
 * through to null rather than being clamped — `fee-resolution.ts` established
 * that a nonsense rate should disable the feature, not silently become a
 * different rate.
 */
export function resolveCentsPerCredit(
  env: NodeJS.ProcessEnv = process.env
): number | null {
  const raw = env[CCR_CENTS_PER_CREDIT_ENV]
  if (raw === undefined || raw === "") return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export type CreditQuote = {
  /** Whole credits to reserve. Zero when the feature is off or nothing applies. */
  creditsApplied: number
  /** Cash value of those credits, in minor units. Never exceeds the subtotal. */
  valueCents: number
  /** What the buyer still owes in cash, in minor units. Never negative. */
  cashDueCents: number
  /** Why fewer credits applied than were asked for, when that happened. */
  limitedBy: "none" | "balance" | "subtotal" | "disabled"
}

/**
 * How many credits can be applied to a cart, and what the buyer then owes.
 *
 * Floor semantics throughout: a credit is only ever applied when its full cash
 * value fits under the remaining subtotal. Partial credits do not exist on
 * this rail, so the alternative — applying a credit worth more than the
 * balance owed — would either overpay the buyer's own cart or leave a
 * fractional credit that cannot be represented. The remainder simply stays in
 * the wallet.
 */
export function quoteCreditApplication(input: {
  subtotalCents: number
  walletCredits: number
  requestedCredits: number
  centsPerCredit: number | null
}): CreditQuote {
  const subtotal = Math.max(0, Math.floor(input.subtotalCents || 0))
  const none = (limitedBy: CreditQuote["limitedBy"]): CreditQuote => ({
    creditsApplied: 0,
    valueCents: 0,
    cashDueCents: subtotal,
    limitedBy,
  })

  const rate = input.centsPerCredit
  if (rate === null || !Number.isInteger(rate) || rate <= 0) {
    return none("disabled")
  }

  const balance = Math.max(0, Math.floor(input.walletCredits || 0))
  const requested = Math.max(0, Math.floor(input.requestedCredits || 0))
  if (requested === 0 || balance === 0 || subtotal === 0) {
    return none("none")
  }

  // Whole credits that fit under the subtotal at this rate.
  const affordableBySubtotal = Math.floor(subtotal / rate)
  const wanted = Math.min(requested, balance)
  const creditsApplied = Math.min(wanted, affordableBySubtotal)

  if (creditsApplied === 0) {
    return none(affordableBySubtotal === 0 ? "subtotal" : "balance")
  }

  const valueCents = creditsApplied * rate

  let limitedBy: CreditQuote["limitedBy"] = "none"
  if (creditsApplied < requested) {
    limitedBy = creditsApplied === affordableBySubtotal ? "subtotal" : "balance"
  }

  return {
    creditsApplied,
    valueCents,
    cashDueCents: subtotal - valueCents,
    limitedBy,
  }
}

/**
 * Stable idempotency keys for the three legs. Derived from the cart id so a
 * retried apply replays one ledger entry rather than reserving twice — the
 * same discipline `credits/withdraw/route.ts` uses for its burn.
 *
 * `apply` carries the credit count because a buyer may legitimately change how
 * many credits they are spending on the same cart; each distinct amount is a
 * distinct reservation, and the previous one is released first.
 */
export const ccrCartIdempotencyKey = {
  apply: (cartId: string, credits: number): string =>
    `ccr-cart-apply:${cartId}:${credits}`,
  settle: (cartId: string): string => `ccr-cart-settle:${cartId}`,
  release: (cartId: string): string => `ccr-cart-release:${cartId}`,
}
