import type { MedusaContainer } from "@medusajs/framework/types"
import { emitBlackoutEvent } from "./blackout-emit"

/**
 * Emit helpers for §2/§3 event families. Three are now invoked from live code:
 *   - `emitReferralAttributed` — from `subscribers/attribute-order-on-placed`
 *   - `emitLedgerUsdcConverted` — from `jobs/hawala-settlement`
 *   - `emitQuestRewardSettled` — from the demand-bounty milestone payout route
 * The remaining three still have no matching source lifecycle in FBM; each TODO
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

// TODO(wire): no trigger exists. FBM never ingests processor chargeback
// notifications: `hawala-ledger` defines dormant `ChargebackProtection` /
// `ChargebackClaim` models (models/payout-config.ts) but no service method,
// route, or webhook handler ever files a claim, and there is no
// `charge.dispute.*` Stripe handler. Call this from that ingestion flow (one
// emit per chargebacked order) when it lands.
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

/** A paid demand-bounty milestone — FBM's monetary quest-reward settlement. */
export type BountyMilestoneSettlement = {
  bountyId: string
  /**
   * The demand post that funded the bounty escrow; its ledger legs already use
   * it as the ORDER reference, so it fills the `fbmOrderId` slot.
   */
  demandPostId: string
  milestoneIndex: number
  /** Hawala working unit (major units / dollars), per `completeBountyMilestone`. */
  payoutAmount: number | string
  currencyCode?: string | null
}

/**
 * Decide whether a paid bounty milestone is reportable as
 * `quest.reward_settled` and shape the emit args if so. Pure — the caller
 * resolves the assignee's Blackout user id first and passes null to skip
 * (never leak a non-Blackout identifier). `questCompletionId` is
 * `<bountyId>:m<index>`, mirroring the payout transfer's idempotency key
 * (`bounty-payout-<bountyId>-m<index>`) so payout retries keep a stable
 * eventId.
 */
export function buildQuestRewardSettledArgs(args: {
  userId: string | null
  settlement: BountyMilestoneSettlement
}): {
  userId: string
  grossCents: number
  currency: string
  fbmOrderId: string
  questCompletionId: string
  questId: string
} | null {
  const { userId, settlement } = args
  if (!userId) {
    return null
  }
  const grossCents = Math.round((Number(settlement.payoutAmount) || 0) * 100)
  if (grossCents <= 0) {
    return null
  }
  return {
    userId,
    grossCents,
    currency: (settlement.currencyCode || "usd").toLowerCase(),
    fbmOrderId: settlement.demandPostId,
    questCompletionId: `${settlement.bountyId}:m${settlement.milestoneIndex}`,
    questId: settlement.bountyId,
  }
}

// WIRED: invoked from the bounty-milestone payout route
// (`api/store/collective/demand-pools/[id]/bounties/[bountyId]/milestones`)
// after `CollectiveHawalaService.completeAndPayMilestone` settles the
// milestone's escrow to the assignee (see `buildQuestRewardSettledArgs`).
// The demand-pool marketing bounty is FBM's quest surface with money
// settlement (`bounty.opened` announces it; this settles it) — collective-quest
// and vendor-quest rewards are XP/packet-only and never touch the ledger.
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

// TODO(wire): no trigger exists. FBM has no ambassador program: nothing models
// a tiered ambassador or a per-period (`periodKey`) commission aggregation, and
// `ambassadorId` names a Blackout-native growth-ledger record FBM never learns.
// Per-order creator commissions already reach Blackout via
// `referral.attributed`; call this only when a periodic ambassador-commission
// payout flow (plus an ambassadorId mapping, à la `lib/blackout-identity`)
// lands — one emit per (ambassador, period) settlement.
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
