import type { MedusaContainer } from "@medusajs/framework/types"
import { emitBlackoutEvent } from "./blackout-emit"

/**
 * Emit helpers for §2/§3 event families. Two are now invoked from live code:
 *   - `emitReferralAttributed` — from `subscribers/attribute-order-on-placed`
 *   - `emitLedgerUsdcConverted` — from `jobs/hawala-settlement`
 * The remaining four still have no matching source lifecycle in FBM; each TODO
 * records the concrete blocker so landing the upstream flow is a one-line call
 * to the matching helper.
 */

// TODO(wire): no trigger exists. Customer purchase failures happen at
// cart-completion before an order is created, so FBM emits no
// `order.payment_failed` / `payment.failed` event to hang this off. (The Stripe
// `payment_intent.payment_failed` webhook concerns ACH payout transactions, not
// customer purchases; subscription renewal failures emit the distinct
// `subscription.payment_failed`, which has no listing/purchase context.)
export function emitPurchaseFailed(
  container: MedusaContainer,
  args: { userId: string; providerListingId: string; kind: string; fbmOrderId: string; sku?: string | null }
) {
  return emitBlackoutEvent(
    container,
    "purchase.failed",
    { userId: args.userId, providerListingId: args.providerListingId, sku: args.sku ?? null, kind: args.kind },
    { eventId: `purchase.failed:${args.fbmOrderId}`, metadata: { fbmOrderId: args.fbmOrderId } }
  )
}

// TODO(wire): call from a chargeback handler once FBM ingests processor
// chargeback notifications (no chargeback flow exists today).
export function emitPurchaseChargebacked(
  container: MedusaContainer,
  args: { userId: string; providerListingId: string; kind: string; fbmOrderId: string }
) {
  return emitBlackoutEvent(
    container,
    "purchase.chargebacked",
    { userId: args.userId, providerListingId: args.providerListingId, kind: args.kind },
    { eventId: `purchase.chargebacked:${args.fbmOrderId}`, metadata: { fbmOrderId: args.fbmOrderId } }
  )
}

// WIRED: invoked from `jobs/hawala-settlement` after a settlement batch is
// anchored to Stellar, once per settled vendor-order entry (see
// `buildUsdcConvertedArgs`). Gated by ENABLE_STELLAR_SETTLEMENT via that job.
export function emitLedgerUsdcConverted(
  container: MedusaContainer,
  args: { vendorId: string; orderId: string; amountMinorUnits: number; currency: string; ledgerTxId: string }
) {
  return emitBlackoutEvent(
    container,
    "ledger.usdc_converted",
    {
      vendorId: args.vendorId,
      orderId: args.orderId,
      amountMinorUnits: args.amountMinorUnits,
      currency: args.currency,
      ledgerTxId: args.ledgerTxId,
    },
    { eventId: `ledger.usdc_converted:${args.ledgerTxId}` }
  )
}

// TODO(wire): call when a quest/reward settlement concept lands (today the
// nearest surface is creator-rewards pool distribution).
export function emitQuestRewardSettled(
  container: MedusaContainer,
  args: { userId: string; grossCents: number; currency: string; fbmOrderId: string; questCompletionId: string; questId: string }
) {
  return emitBlackoutEvent(
    container,
    "quest.reward_settled",
    { userId: args.userId },
    {
      eventId: `quest.reward_settled:${args.questCompletionId}`,
      metadata: {
        grossCents: args.grossCents,
        currency: args.currency,
        fbmOrderId: args.fbmOrderId,
        questCompletionId: args.questCompletionId,
        questId: args.questId,
      },
    }
  )
}

// WIRED: invoked from `subscribers/attribute-order-on-placed` after the
// attribution is held, when the referrer's Blackout user id resolves (see
// `buildReferralAttributedArgs`).
export function emitReferralAttributed(
  container: MedusaContainer,
  args: { userId: string; grossCents: number; currency: string; fbmOrderId: string; referralId: string }
) {
  return emitBlackoutEvent(
    container,
    "referral.attributed",
    { userId: args.userId },
    {
      eventId: `referral.attributed:${args.referralId}`,
      metadata: {
        grossCents: args.grossCents,
        currency: args.currency,
        fbmOrderId: args.fbmOrderId,
        referralId: args.referralId,
      },
    }
  )
}

// TODO(wire): call from the ambassador commission payout path.
export function emitAmbassadorCommissionPaid(
  container: MedusaContainer,
  args: { userId: string; grossCents: number; currency: string; ambassadorId: string; periodKey: string }
) {
  return emitBlackoutEvent(
    container,
    "ambassador.commission_paid",
    { userId: args.userId },
    {
      eventId: `ambassador.commission_paid:${args.ambassadorId}:${args.periodKey}`,
      metadata: {
        grossCents: args.grossCents,
        currency: args.currency,
        ambassadorId: args.ambassadorId,
        periodKey: args.periodKey,
      },
    }
  )
}
