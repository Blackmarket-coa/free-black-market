import type { MedusaContainer } from "@medusajs/framework/types"
import { emitBlackoutEvent } from "./blackout-emit"
import { sanitizeCheckoutMetadata } from "./blackout-checkout"
import {
  BLACKOUT_PURCHASE_KINDS,
  mapEntitlementKindToBlackout,
  type BlackoutPurchaseKind,
} from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Emit helpers for §2/§3 event families. Five are now invoked from live code:
 *   - `emitReferralAttributed` — from `subscribers/attribute-order-on-placed`
 *   - `emitLedgerUsdcConverted` — from `jobs/hawala-settlement`
 *   - `emitQuestRewardSettled` — from the demand-bounty milestone payout route
 *   - `emitPurchaseFailed` / `emitPurchaseChargebacked` — from
 *     `subscribers/emit-blackout-stripe-payment-events` (verified Stripe
 *     webhooks, Blackout-checkout purchases only)
 * `emitAmbassadorCommissionPaid` still has no matching source lifecycle in
 * FBM; its TODO records the concrete blocker.
 */

/** The `blackout_checkout_session` fields the Stripe-driven emits read. */
export type BlackoutCheckoutSessionLike = {
  id: string
  blackout_user_id?: string | null
  listing_id?: string | null
  status?: string | null
  order_id?: string | null
  /** The bounded echo Blackout supplied at session creation (tipId, ...). */
  requested_metadata?: unknown
}

/**
 * The §2 `kind` for a listing's `entitlement_kind`, derived exactly as
 * `purchase.succeeded` derives it (`subscribers/emit-blackout-order-placed`):
 * a §2 purchase kind passes through verbatim, an internal EntitlementKind is
 * mapped.
 */
export function toBlackoutPurchaseKind(
  raw: string | null | undefined
): BlackoutPurchaseKind {
  return raw && (BLACKOUT_PURCHASE_KINDS as readonly string[]).includes(raw)
    ? (raw as BlackoutPurchaseKind)
    : mapEntitlementKindToBlackout(raw)
}

/** Payment-session statuses under which the money already moved. */
const SETTLED_PAYMENT_SESSION_STATUSES = new Set(["authorized", "captured"])

export type PurchaseFailedArgs = {
  userId: string
  providerListingId: string
  kind: string
  checkoutSessionId: string
  cartId: string
  sku?: string | null
  metadata?: Record<string, string> | null
}

/**
 * Decide whether a failed Stripe charge on a Blackout-checkout cart is
 * reportable as `purchase.failed`, and shape the args if so. Pure — the
 * subscriber resolves the checkout session, cart state and listing first.
 *
 * Blackout answers `purchase.failed` by revoking the member's entitlement for
 * (userId, listing) whatever granted it, so this only reports while nothing
 * can have been granted: the checkout has not completed (session, cart, or an
 * authorized/captured payment session say otherwise) and no earlier checkout
 * of the same listing by the same member completed. Everything else skips.
 * Residual gap: if the member then succeeds in the same checkout and this
 * event's delivery is retried past that `purchase.succeeded`, Blackout would
 * revoke the fresh grant — closing that needs Blackout to not revoke a grant
 * a later `purchase.succeeded` made.
 *
 * `sku` stays null like the shadow product's `purchase.succeeded` line.
 */
export function buildPurchaseFailedArgs(args: {
  session: BlackoutCheckoutSessionLike | null | undefined
  cartId: string
  cartCompleted: boolean
  paymentSessionStatus?: string | null
  listingEntitlementKind?: string | null
  hasPriorCompletedPurchase: boolean
}): PurchaseFailedArgs | null {
  const { session } = args
  if (!session?.blackout_user_id || !session.listing_id) {
    return null
  }
  if (session.status === "completed" || session.order_id || args.cartCompleted) {
    return null
  }
  if (
    args.paymentSessionStatus &&
    SETTLED_PAYMENT_SESSION_STATUSES.has(args.paymentSessionStatus)
  ) {
    return null
  }
  if (args.hasPriorCompletedPurchase) {
    return null
  }
  return {
    userId: session.blackout_user_id,
    providerListingId: session.listing_id,
    kind: toBlackoutPurchaseKind(args.listingEntitlementKind),
    checkoutSessionId: session.id,
    cartId: args.cartId,
    sku: null,
    metadata: sanitizeCheckoutMetadata(session.requested_metadata),
  }
}

export type PurchaseChargebackedArgs = {
  userId: string
  providerListingId: string
  kind: string
  fbmOrderId: string
  metadata?: Record<string, string> | null
}

/**
 * Shape `purchase.chargebacked` args for a Blackout-checkout purchase whose
 * payment was charged back. Pure. Skips when the session carries no Blackout
 * identity or no order exists (nothing was purchased to charge back). The
 * session's echo rides along so Blackout's tip / creator-subscription /
 * canopy / boost handlers reverse the right record, as for a refund.
 */
export function buildPurchaseChargebackedArgs(args: {
  session: BlackoutCheckoutSessionLike | null | undefined
  /** Order found via the cart when the session never recorded one. */
  orderId?: string | null
  listingEntitlementKind?: string | null
}): PurchaseChargebackedArgs | null {
  const { session } = args
  if (!session?.blackout_user_id || !session.listing_id) {
    return null
  }
  const fbmOrderId = session.order_id || args.orderId
  if (!fbmOrderId) {
    return null
  }
  return {
    userId: session.blackout_user_id,
    providerListingId: session.listing_id,
    kind: toBlackoutPurchaseKind(args.listingEntitlementKind),
    fbmOrderId,
    metadata: sanitizeCheckoutMetadata(session.requested_metadata),
  }
}

/**
 * Whether a verified Stripe event is a chargeback: funds withdrawn for a
 * dispute, or a dispute opened past the inquiry stage. Inquiries
 * (`warning_*` statuses) withdraw nothing and may never escalate; if one
 * does, `charge.dispute.funds_withdrawn` reports it then.
 */
export function isStripeChargebackEvent(event: {
  type: string
  data: { object: unknown }
}): boolean {
  if (event.type === "charge.dispute.funds_withdrawn") {
    return true
  }
  if (event.type !== "charge.dispute.created") {
    return false
  }
  const status = (event.data.object as { status?: unknown } | null)?.status
  return typeof status === "string" && !status.startsWith("warning_")
}

/** The PaymentIntent a Stripe dispute charged back, as an id or expanded object. */
export function stripeDisputePaymentIntentId(dispute: unknown): string | null {
  const pi = (dispute as { payment_intent?: unknown } | null)?.payment_intent
  if (typeof pi === "string" && pi.length > 0) {
    return pi
  }
  const id = (pi as { id?: unknown } | null)?.id
  return typeof id === "string" && id.length > 0 ? id : null
}

// WIRED: invoked from `subscribers/emit-blackout-stripe-payment-events` on a
// signature-verified Stripe `payment_intent.payment_failed` delivered to
// Medusa's payment webhook (`/hooks/payment/<provider>`), for Blackout-checkout
// carts only (see `buildPurchaseFailedArgs`). No order exists yet, so the
// event is keyed by the Blackout checkout session — one per checkout Blackout
// initiated, however many cards are declined in it — and carries
// `fbmCheckoutSessionId` / `fbmCartId` instead of `fbmOrderId`.
export function emitPurchaseFailed(container: MedusaContainer, args: PurchaseFailedArgs) {
  return emitBlackoutEvent(
    container,
    "purchase.failed",
    { userId: args.userId, providerListingId: args.providerListingId, sku: args.sku ?? null, kind: args.kind },
    {
      eventId: `purchase.failed:${args.checkoutSessionId}`,
      metadata: {
        ...(args.metadata ?? {}),
        fbmCheckoutSessionId: args.checkoutSessionId,
        fbmCartId: args.cartId,
      },
    }
  )
}

// WIRED: invoked from `subscribers/emit-blackout-stripe-payment-events` on a
// signature-verified Stripe chargeback (see `isStripeChargebackEvent`) whose
// PaymentIntent paid a Blackout-checkout order (see
// `buildPurchaseChargebackedArgs`). Report-only: FBM's own dispute and ledger
// handling is untouched — `hawala-ledger`'s `ChargebackClaim` model
// (models/payout-config.ts) still has no writer.
export function emitPurchaseChargebacked(container: MedusaContainer, args: PurchaseChargebackedArgs) {
  return emitBlackoutEvent(
    container,
    "purchase.chargebacked",
    { userId: args.userId, providerListingId: args.providerListingId, kind: args.kind },
    {
      eventId: `purchase.chargebacked:${args.fbmOrderId}`,
      metadata: { ...(args.metadata ?? {}), fbmOrderId: args.fbmOrderId },
    }
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

// TODO(wire): no trigger exists. FBM does compute commissions, but none of them
// is this event: creator commissions are per order — `creator-attribution`
// writes one row per referral level at `order.placed`, and
// `jobs/creator-attribution-approve-held` credits each row to the ledger when
// its hold expires — and the level-1 row already reaches Blackout as
// `referral.attributed`. Nothing in FBM models an ambassador or settles
// commission per period (`periodKey`), and `ambassadorId` must name Blackout's
// own ambassador record (its consumer acks an unknown one as unresolvable),
// which FBM has no mapping to. Call this only when a periodic
// ambassador-commission payout flow (plus an ambassadorId mapping, à la
// `lib/blackout-identity`) lands — one emit per (ambassador, period)
// settlement.
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
