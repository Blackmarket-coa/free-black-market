/**
 * Fee-first split (docs/BLACK_MASK_LAUNCH_PLAN.md §5 F6; operator decision
 * 2026-10-05 item 6): "processing fee comes out of total then is split".
 *
 * Pure, integer cents, no container, no I/O, no env — the same discipline as
 * `fee-resolution.ts`. What it answers, for one charge FBM's own Stripe
 * account makes:
 *
 *   1. The card-processing ESTIMATE on the whole charge:
 *        processing = round(chargedTotal × percent / 100) + fixed
 *      with the fixed part counted ONCE per charge, never once per seller.
 *      It is an estimate (payout_config `payment_processing_percent` /
 *      `payment_processing_fixed`, 2.9% + 30¢ by default) because settlement
 *      runs at `order.placed`, before Stripe's balance transaction exists.
 *      An actual-fee true-up is a named follow-up, not this function.
 *   2. Who bears it. Each seller bears the share of it that sits in their own
 *      leg of the charge (`chargedCents`: what their seller leg receives out
 *      of the charge — the subtotal plus whatever tax / delivery / tip sits in
 *      that leg), pro rata. Charged money that sits in NO seller's leg
 *      (`unattributedChargedCents`) carries its processing to the PLATFORM.
 *      Floors first, then every remaining cent to the largest seller leg, so
 *      the parts sum to the total exactly.
 *   3. The commission, on what is left:
 *        commission = round(feePercent / 100 × max(0, subtotal − processingShare))
 *
 * Clamps: no seller's processing share exceeds their leg (the excess is
 * platform-borne), commission is never negative and never exceeds what the
 * leg has left after processing, so a seller's net is never negative.
 *
 * Donations are NOT an input here, by finding rather than by choice: the
 * Phase 1 donation is a separate direct charge on the recipient org's own
 * Stripe account (`modules/donation/direct-split-guard.ts`, rule 1), so it is
 * not in FBM's charged total and the org's account bears its processing
 * natively; and the legacy tier-2 donation (flag off) is cart metadata only
 * (`storefront/src/lib/data/donations.ts` `setCartDonationPreferences`) and
 * never adds to the cart total either. Should a donation ever be collected
 * inside FBM's own charge, pass it as `unattributedChargedCents`: its
 * processing is then platform-borne, never a seller's and never deducted from
 * the donation.
 *
 * Rate arithmetic is exact: a percentage is scaled to an integer (1/10 000 of
 * a percent), so `500 × 2.9%` rounds 14.5 → 15 as written, where the float
 * `500 * (2.9 / 100)` is 14.499999999999998 and `Math.round` gives 14.
 */

/**
 * The documented default processing estimate (2.9% + 30¢), the figures
 * `PayoutBreakdownService.getDefaultConfig` seeds payout_config with. A
 * settlement that cannot read payout_config uses these, and says so in the
 * processing leg's metadata.
 */
export const DEFAULT_PROCESSING_PERCENT = 2.9
export const DEFAULT_PROCESSING_FIXED_CENTS = 30

/** One ten-thousandth of a percent. 2.9% → 29 000, 3% → 30 000, 100% → 1 000 000. */
const PERCENT_SCALE = 10_000
const WHOLE = 100 * PERCENT_SCALE

export type FeeFirstSellerInput = {
  sellerId: string
  /** The seller's goods subtotal: the commission base before processing. */
  subtotalCents: number
  /**
   * What this seller's leg receives out of the charge: the subtotal plus any
   * tax / delivery / tip / pickup discount that sits in that leg. Defaults to
   * the subtotal.
   */
  chargedCents?: number
  /** The resolved platform-fee rate for this seller (0..100). */
  feePercent: number
}

export type FeeFirstInput = {
  sellers: FeeFirstSellerInput[]
  /** Charged money that sits in no seller's leg; its processing is platform-borne. */
  unattributedChargedCents?: number
  /** payout_config.payment_processing_percent */
  processingPercent: number
  /** payout_config.payment_processing_fixed (cents, once per charge) */
  processingFixedCents: number
}

export type FeeFirstSellerSplit = {
  sellerId: string
  subtotalCents: number
  chargedCents: number
  feePercent: number
  /** This seller's share of the processing estimate. */
  processingCents: number
  /** round(feePercent% × max(0, subtotal − processing)). */
  commissionCents: number
  /** What the seller's leg keeps: charged − processing − commission. */
  sellerNetCents: number
}

export type FeeFirstSplit = {
  chargedTotalCents: number
  processingPercent: number
  processingFixedCents: number
  /** The whole estimate for the charge (fixed part counted once). */
  processingTotalCents: number
  /** Sum of every seller's `processingCents`. */
  sellerBorneProcessingCents: number
  /**
   * Processing on money in no seller's leg, plus anything a clamp could not
   * put on a seller. Recorded, never charged to a seller.
   */
  platformBorneProcessingCents: number
  sellers: FeeFirstSellerSplit[]
}

function assertPercent(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`fee-first: ${name} must be a finite percentage in 0..100 (got ${value})`)
  }
}

function assertCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`fee-first: ${name} must be an integer number of cents (got ${value})`)
  }
}

/** `percent` as an integer count of 1/10 000ths of a percent. */
function scaledPercent(percent: number): number {
  return Math.round(percent * PERCENT_SCALE)
}

/** round-half-up(amount × percent / 100) for non-negative integer `amount`, exactly. */
export function percentOfCents(amountCents: number, percent: number): number {
  assertCents("amount", amountCents)
  assertPercent("percent", percent)
  if (amountCents <= 0) return 0
  const numerator = amountCents * scaledPercent(percent)
  if (!Number.isSafeInteger(numerator)) {
    // Beyond ~$90bn at 100%: not a real order; keep it bounded, not exact.
    return Math.round((amountCents * percent) / 100)
  }
  return Math.floor((2 * numerator + WHOLE) / (2 * WHOLE))
}

/**
 * The estimate for one charge: round(charged × percent / 100) + fixed, the
 * fixed part once. A charge of nothing costs nothing.
 */
export function processingEstimateCents(
  chargedTotalCents: number,
  processingPercent: number,
  processingFixedCents: number
): number {
  assertCents("chargedTotalCents", chargedTotalCents)
  if (!Number.isFinite(processingFixedCents) || processingFixedCents < 0) {
    throw new RangeError(
      `fee-first: processingFixedCents must be a non-negative number (got ${processingFixedCents})`
    )
  }
  if (chargedTotalCents <= 0) return 0
  return percentOfCents(chargedTotalCents, processingPercent) + Math.round(processingFixedCents)
}

/**
 * The commission formula in force before F6, exactly as
 * `PayoutBreakdownService.calculateBreakdown` has always written it:
 * `Math.round(subtotal * (pct / 100))`, float and all. Exported so a flag-off
 * caller can be asserted byte-identical against it; NOT the fee-first rule.
 */
export function legacyPlatformFeeCents(subtotalCents: number, feePercent: number): number {
  return Math.round(subtotalCents * (feePercent / 100))
}

export function computeFeeFirstSplit(input: FeeFirstInput): FeeFirstSplit {
  assertPercent("processingPercent", input.processingPercent)
  const unattributed = Math.max(0, input.unattributedChargedCents ?? 0)
  assertCents("unattributedChargedCents", unattributed)

  const sellers = input.sellers.map((s) => {
    assertPercent(`feePercent for ${s.sellerId}`, s.feePercent)
    assertCents(`subtotalCents for ${s.sellerId}`, s.subtotalCents)
    const charged = s.chargedCents ?? s.subtotalCents
    assertCents(`chargedCents for ${s.sellerId}`, charged)
    return {
      sellerId: s.sellerId,
      feePercent: s.feePercent,
      subtotalCents: Math.max(0, s.subtotalCents),
      chargedCents: Math.max(0, charged),
    }
  })

  const sellerChargedTotal = sellers.reduce((sum, s) => sum + s.chargedCents, 0)
  const chargedTotalCents = sellerChargedTotal + unattributed
  const processingTotalCents = processingEstimateCents(
    chargedTotalCents,
    input.processingPercent,
    input.processingFixedCents
  )

  // Pro rata by leg, floored; the platform's share (money in no leg) floored
  // the same way; every remaining cent to the largest leg (first on a tie).
  const shares = sellers.map((s) =>
    chargedTotalCents > 0 ? Math.floor((processingTotalCents * s.chargedCents) / chargedTotalCents) : 0
  )
  let platformShare =
    chargedTotalCents > 0 ? Math.floor((processingTotalCents * unattributed) / chargedTotalCents) : 0
  const remainder = processingTotalCents - platformShare - shares.reduce((a, b) => a + b, 0)
  let largest = -1
  for (let i = 0; i < sellers.length; i++) {
    if (sellers[i].chargedCents > 0 && (largest < 0 || sellers[i].chargedCents > sellers[largest].chargedCents)) {
      largest = i
    }
  }
  if (largest >= 0) shares[largest] += remainder
  else platformShare += remainder

  const split: FeeFirstSellerSplit[] = sellers.map((s, i) => {
    // Clamp: a seller never bears more processing than their leg holds.
    const processingCents = Math.min(shares[i], s.chargedCents)
    platformShare += shares[i] - processingCents
    const left = s.chargedCents - processingCents
    const commissionCents = Math.min(
      percentOfCents(Math.max(0, s.subtotalCents - processingCents), s.feePercent),
      left
    )
    return {
      sellerId: s.sellerId,
      subtotalCents: s.subtotalCents,
      chargedCents: s.chargedCents,
      feePercent: s.feePercent,
      processingCents,
      commissionCents,
      sellerNetCents: left - commissionCents,
    }
  })

  return {
    chargedTotalCents,
    processingPercent: input.processingPercent,
    processingFixedCents: Math.round(input.processingFixedCents),
    processingTotalCents,
    sellerBorneProcessingCents: split.reduce((sum, s) => sum + s.processingCents, 0),
    platformBorneProcessingCents: platformShare,
    sellers: split,
  }
}
