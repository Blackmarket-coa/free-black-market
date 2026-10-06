/**
 * The card-processing leg of a fee-first order settlement (Black Mask F6,
 * `FF_FEE_FIRST_SPLIT_V1`; operator decision 2026-10-05 6d / 6e).
 *
 * With the fee-first split on, the card-processing ESTIMATE comes off FBM's
 * charge before the platform fee. The ledger records it as its own leg,
 * ESCROW -> a dedicated system account, so escrow still nets to zero and the
 * amount is visible as what it is:
 *
 *   - account_type PLATFORM_FEE, owner_type SYSTEM, owner_id `processing`.
 *     Never SETTLEMENT (the vendor-payout settlement account) and never the
 *     shared PLATFORM_FEE balance owned by `system`: the plugin and referral
 *     disbursers draw on that one under balance guards, and processing money
 *     there would read as commission they may pay out. The singleton lookup
 *     (`getOrCreateSystemAccount`) pins owner_id, so the two never mix.
 *   - entry_type FEE (existing vocabulary), keyed `<order key>-processing`
 *     from the record, stamped `metadata.leg = CARD_PROCESSING_LEG`.
 *
 * USD only, record-only: the leg moves a ledger figure inside FBM's own
 * books, mirroring money Stripe keeps from FBM's own charge. No balance is
 * held for anyone, nothing is paid out of it, and the Posture A guard treats
 * USD as passthrough (`posture-a-guard.ts`). No new reference type.
 *
 * On a refund the leg is NOT reversed (6e): Stripe keeps its fee on a
 * refunded charge, and the vendor bears it. `processRefund` leaves the leg
 * COMPLETED and the seller balancing leg absorbs it, so escrow still nets to
 * zero.
 *
 * The vendor-shortfall leg. A vendor whose only unpaid earnings are this
 * order's (the commonest shape: one order since the last payout) holds less
 * than the balancing leg, because the order credited them sale - processing
 * - fee while the refund takes back sale - fee. The ledger refuses a negative
 * balance, so the refund cannot simply overdraw them; refusing the refund
 * instead would leave earnings for a refunded order payable by ACH. So the
 * refund ALWAYS posts: the vendor's leg takes everything they hold up to the
 * planned amount, and the gap (never more than the retained processing) is
 * funded card-processing account -> ESCROW as its own leg, entry_type
 * ADJUSTMENT, `metadata.leg = CARD_PROCESSING_SHORTFALL_LEG`, naming the
 * seller account it is owed by. That leg is the record of a receivable from
 * the vendor: the processing leg itself stays COMPLETED (Stripe did keep the
 * fee), and the processing account's balance reads as processing actually
 * borne by vendors. Whether the receivable is netted against the vendor's
 * future payouts (a later seller -> card-processing leg) or written off as
 * platform-borne is an OPERATOR decision this does not make; until it is
 * made, FF_FEE_FIRST_SPLIT_V1 must not be set (`shared/feature-flags.ts`).
 */

export const CARD_PROCESSING_ACCOUNT_TYPE = "PLATFORM_FEE"
export const CARD_PROCESSING_OWNER_ID = "processing"
export const CARD_PROCESSING_LEG = "card_processing_estimate"
export const CARD_PROCESSING_SHORTFALL_LEG = "card_processing_vendor_shortfall"

/** True for the fee-first processing leg of an order settlement. */
export function isCardProcessingLeg(entry: {
  entry_type?: string | null
  metadata?: unknown
}): boolean {
  return (
    entry.entry_type === "FEE" &&
    (entry.metadata as { leg?: unknown } | null | undefined)?.leg === CARD_PROCESSING_LEG
  )
}

/**
 * True for the refund leg that records a vendor's processing shortfall: the
 * part of the retained processing their earnings could not absorb, owed by
 * `metadata.owed_by_account_id` (a receivable pending the operator decision).
 */
export function isCardProcessingShortfallLeg(entry: {
  entry_type?: string | null
  metadata?: unknown
}): boolean {
  return (
    entry.entry_type === "ADJUSTMENT" &&
    (entry.metadata as { leg?: unknown } | null | undefined)?.leg === CARD_PROCESSING_SHORTFALL_LEG
  )
}
