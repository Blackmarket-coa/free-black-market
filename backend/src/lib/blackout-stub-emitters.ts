import type { MedusaContainer } from "@medusajs/framework/types"
import { emitBlackoutEvent } from "./blackout-emit"

/**
 * Ready-to-call emit helpers for §2/§3 event families whose *source lifecycle*
 * does not exist in FBM yet. The envelope/type surface is fully wired here, so
 * landing the upstream flow is a one-line call to the matching helper.
 *
 * Per the cutover decision ("wire real hooks, stub the rest"), these are NOT
 * invoked from any live code path today — each TODO marks where the real
 * trigger will plug in.
 */

// TODO(wire): call from a payment-failed subscriber once FBM emits a
// payment.failed / order.payment_failed event.
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

// TODO(wire): call from the Stellar/USDC conversion path once a usdc-converted
// ledger entry type exists (gated by ENABLE_STELLAR_SETTLEMENT).
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

// TODO(wire): call from attribute-order-on-placed once a Blackout user id is
// resolvable for the referrer.
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
