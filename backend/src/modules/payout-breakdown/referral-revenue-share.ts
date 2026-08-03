/**
 * Generic referral revenue share.
 *
 * `payout_config.referral_percent` and `FeeType.REFERRAL_FEE` have existed in
 * the model, the migrations and the enum since
 * `Migration20260506200AddPluginAndReferralSplits` but were read nowhere: the
 * plugin share had a payee waiting (the plugin author), while a generic
 * referral had no record of who referred whom. `modules/referral` is that
 * record; this is the computation that pays it. Pure, like
 * `plugin-revenue-share.ts`, so the allocation asserts to the cent without a
 * container.
 *
 * ## The two decisions mirror the plugin share, with one addition
 *
 * **Carved OUT of the platform fee, never added on top** — same reason: a
 * referral must not make the referred seller's net depend on who referred them,
 * and the payout can never exceed what the platform collected.
 *
 * **Funded from what the plugin share LEFT, not the whole platform fee.** Both
 * shares come out of the one platform fee, so if each capped independently at
 * the full fee they could together promise more than the platform kept —
 * paying out money that was never collected. The referral share is therefore
 * computed against `availablePlatformFeeCents`, which the caller sets to the
 * platform fee *after* the plugin share was removed. Plugin developers rank
 * ahead of referrers when the fee is too small to cover both: an actively-used
 * tool is a stronger claim on the platform's cut than a one-time introduction,
 * and the order has to be *some* fixed rule for the allocation to be
 * deterministic.
 *
 * A single payee, so there is no even-split or remainder-cent handling — the
 * referral is one seller or none.
 */

export type ReferralShareAllocation = {
  referrer_seller_id: string
  referred_seller_id: string
  amount_cents: number
}

export type ReferralRevenueShare = {
  /** Moved to the referrer, in cents. `0` when there is no earning referral. */
  amount_cents: number
  allocation: ReferralShareAllocation | null
  /** What the platform keeps after the referral share. Never negative. */
  platform_retained_cents: number
}

export function computeReferralRevenueShare(input: {
  /**
   * The platform fee still available after any plugin share was removed, in
   * cents. This is the ceiling — the referral share can never exceed it.
   */
  availablePlatformFeeCents: number
  /** `payout_config.referral_percent`, as a percentage of seller gross. */
  referralPercent: number
  /** The seller's gross for this order, in cents. */
  sellerSubtotalCents: number
  /** The seller owed the share, or null when there is no earning referral. */
  referrerSellerId: string | null
  /** The selling vendor, excluded so a self-referral can never pay out. */
  sellerId: string
}): ReferralRevenueShare {
  const available = Math.max(0, Math.floor(input.availablePlatformFeeCents || 0))
  const none: ReferralRevenueShare = {
    amount_cents: 0,
    allocation: null,
    platform_retained_cents: available,
  }

  if (
    !input.referrerSellerId ||
    input.referrerSellerId === input.sellerId ||
    !Number.isFinite(input.referralPercent) ||
    input.referralPercent <= 0 ||
    input.referralPercent > 100 ||
    available <= 0
  ) {
    return none
  }

  const subtotal = Math.max(0, Math.floor(input.sellerSubtotalCents || 0))
  const desired = Math.round(subtotal * (input.referralPercent / 100))

  // The cap is the whole point of funding it from what remains: a misconfigured
  // percentage, or a stack with the plugin share, costs the platform its fee —
  // never the seller their payout, and never money that was not collected.
  const amount = Math.min(desired, available)
  if (amount <= 0) return none

  return {
    amount_cents: amount,
    allocation: {
      referrer_seller_id: input.referrerSellerId,
      referred_seller_id: input.sellerId,
      amount_cents: amount,
    },
    platform_retained_cents: available - amount,
  }
}
