import {
  buildPurchaseChargebackedArgs,
  buildPurchaseFailedArgs,
  buildQuestRewardSettledArgs,
  emitAmbassadorCommissionPaid,
  emitLedgerUsdcConverted,
  emitPurchaseChargebacked,
  emitPurchaseFailed,
  emitQuestRewardSettled,
  emitReferralAttributed,
  isStripeChargebackEvent,
  stripeDisputePaymentIntentId,
  toBlackoutPurchaseKind,
} from "../blackout-stub-emitters"

jest.mock("../blackout-emit", () => ({
  emitBlackoutEvent: jest.fn().mockResolvedValue("evt"),
}))

import { emitBlackoutEvent } from "../blackout-emit"

const container = {} as any
const emit = emitBlackoutEvent as jest.Mock

beforeEach(() => {
  emit.mockClear()
})

describe("blackout stub emitters build the contract envelopes", () => {
  it("quest.reward_settled: userId-only fields, deterministic eventId per completion", async () => {
    await emitQuestRewardSettled(container, {
      userId: "bo_user_1",
      grossCents: 1250,
      currency: "usd",
      fbmOrderId: "dp_1",
      questCompletionId: "bounty_1:m2",
      questId: "bounty_1",
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "quest.reward_settled",
      { userId: "bo_user_1" },
      {
        eventId: "quest.reward_settled:bounty_1:m2",
        metadata: {
          grossCents: 1250,
          currency: "usd",
          fbmOrderId: "dp_1",
          questCompletionId: "bounty_1:m2",
          questId: "bounty_1",
        },
      }
    )
  })

  it("referral.attributed: eventId keyed by referralId", async () => {
    await emitReferralAttributed(container, {
      userId: "bo_user_1",
      grossCents: 500,
      currency: "usd",
      fbmOrderId: "order_1",
      referralId: "attr_1",
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "referral.attributed",
      { userId: "bo_user_1" },
      expect.objectContaining({ eventId: "referral.attributed:attr_1" })
    )
  })

  it("ambassador.commission_paid: eventId keyed by (ambassadorId, periodKey)", async () => {
    await emitAmbassadorCommissionPaid(container, {
      userId: "bo_user_1",
      grossCents: 100,
      currency: "usd",
      ambassadorId: "amb_1",
      periodKey: "2026-07",
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "ambassador.commission_paid",
      { userId: "bo_user_1" },
      expect.objectContaining({ eventId: "ambassador.commission_paid:amb_1:2026-07" })
    )
  })

  it("ledger.usdc_converted: eventId keyed by ledgerTxId, vendor fields top-level", async () => {
    await emitLedgerUsdcConverted(container, {
      vendorId: "seller_1",
      orderId: "order_1",
      amountMinorUnits: 4250,
      currency: "USD",
      ledgerTxId: "tx_1",
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "ledger.usdc_converted",
      {
        vendorId: "seller_1",
        orderId: "order_1",
        amountMinorUnits: 4250,
        currency: "USD",
        ledgerTxId: "tx_1",
      },
      { eventId: "ledger.usdc_converted:tx_1" }
    )
  })

  it("purchase.failed: keyed by checkout session (no order exists yet), echo under FBM keys", async () => {
    await emitPurchaseFailed(container, {
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "asset_bundle",
      checkoutSessionId: "bcs_1",
      cartId: "cart_1",
      metadata: { tipId: "tip_1", fbmCartId: "spoofed" },
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "purchase.failed",
      { userId: "bo_user_1", providerListingId: "listing_1", sku: null, kind: "asset_bundle" },
      {
        eventId: "purchase.failed:bcs_1",
        metadata: { tipId: "tip_1", fbmCheckoutSessionId: "bcs_1", fbmCartId: "cart_1" },
      }
    )
  })

  it("purchase.chargebacked: eventId keyed by fbmOrderId, echo under fbmOrderId", async () => {
    await emitPurchaseChargebacked(container, {
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "asset_bundle",
      fbmOrderId: "order_1",
      metadata: { creatorSubscriptionId: "csub_1" },
    })

    expect(emit).toHaveBeenCalledWith(
      container,
      "purchase.chargebacked",
      { userId: "bo_user_1", providerListingId: "listing_1", kind: "asset_bundle" },
      {
        eventId: "purchase.chargebacked:order_1",
        metadata: { creatorSubscriptionId: "csub_1", fbmOrderId: "order_1" },
      }
    )
  })
})

describe("toBlackoutPurchaseKind", () => {
  it("passes §2 kinds through and maps internal EntitlementKinds (as purchase.succeeded does)", () => {
    expect(toBlackoutPurchaseKind("subscription_tier")).toBe("subscription_tier")
    expect(toBlackoutPurchaseKind("access_pass")).toBe("channel_access")
    expect(toBlackoutPurchaseKind(null)).toBe("vault_item")
  })
})

describe("buildPurchaseFailedArgs", () => {
  const session = {
    id: "bcs_1",
    blackout_user_id: "bo_user_1",
    listing_id: "listing_1",
    status: "pending",
    order_id: null,
    requested_metadata: { tipId: "tip_1", nested: { no: 1 } },
  }
  const base = {
    session,
    cartId: "cart_1",
    cartCompleted: false,
    paymentSessionStatus: "pending",
    listingEntitlementKind: "digital",
    hasPriorCompletedPurchase: false,
  }

  it("reports an open Blackout checkout whose charge failed", () => {
    expect(buildPurchaseFailedArgs(base)).toEqual({
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "asset_bundle",
      checkoutSessionId: "bcs_1",
      cartId: "cart_1",
      sku: null,
      metadata: { tipId: "tip_1" },
    })
  })

  it("skips once the checkout completed (session, order, cart, or settled payment)", () => {
    expect(buildPurchaseFailedArgs({ ...base, session: { ...session, status: "completed" } })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, session: { ...session, order_id: "order_1" } })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, cartCompleted: true })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, paymentSessionStatus: "authorized" })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, paymentSessionStatus: "captured" })).toBeNull()
  })

  it("skips when an earlier purchase of the listing stands (Blackout would revoke it)", () => {
    expect(buildPurchaseFailedArgs({ ...base, hasPriorCompletedPurchase: true })).toBeNull()
  })

  it("skips without a Blackout identity or listing (never a non-Blackout id)", () => {
    expect(buildPurchaseFailedArgs({ ...base, session: null })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, session: { ...session, blackout_user_id: null } })).toBeNull()
    expect(buildPurchaseFailedArgs({ ...base, session: { ...session, listing_id: "" } })).toBeNull()
  })
})

describe("buildPurchaseChargebackedArgs", () => {
  const session = {
    id: "bcs_1",
    blackout_user_id: "bo_user_1",
    listing_id: "listing_1",
    status: "completed",
    order_id: "order_1",
    requested_metadata: { canopyPlanCode: "coalition" },
  }

  it("reports the session's order with the checkout echo", () => {
    expect(
      buildPurchaseChargebackedArgs({ session, orderId: "order_other", listingEntitlementKind: "subscription_tier" })
    ).toEqual({
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "subscription_tier",
      fbmOrderId: "order_1",
      metadata: { canopyPlanCode: "coalition" },
    })
  })

  it("falls back to the cart's order when the session never recorded one", () => {
    expect(
      buildPurchaseChargebackedArgs({ session: { ...session, order_id: null }, orderId: "order_2" })?.fbmOrderId
    ).toBe("order_2")
  })

  it("skips when no order exists or the session has no Blackout identity", () => {
    expect(buildPurchaseChargebackedArgs({ session: { ...session, order_id: null }, orderId: null })).toBeNull()
    expect(
      buildPurchaseChargebackedArgs({ session: { ...session, blackout_user_id: null }, orderId: "order_1" })
    ).toBeNull()
  })
})

describe("Stripe dispute helpers", () => {
  const dispute = (type: string, status: string) => ({ type, data: { object: { status } } })

  it("counts funds withdrawn and non-inquiry disputes as chargebacks", () => {
    expect(isStripeChargebackEvent(dispute("charge.dispute.created", "needs_response"))).toBe(true)
    expect(isStripeChargebackEvent(dispute("charge.dispute.funds_withdrawn", "needs_response"))).toBe(true)
  })

  it("ignores inquiries, other dispute lifecycle events and non-dispute events", () => {
    expect(isStripeChargebackEvent(dispute("charge.dispute.created", "warning_needs_response"))).toBe(false)
    expect(isStripeChargebackEvent(dispute("charge.dispute.closed", "lost"))).toBe(false)
    expect(isStripeChargebackEvent(dispute("payment_intent.payment_failed", "requires_payment_method"))).toBe(false)
  })

  it("reads the disputed PaymentIntent id, expanded or not", () => {
    expect(stripeDisputePaymentIntentId({ payment_intent: "pi_1" })).toBe("pi_1")
    expect(stripeDisputePaymentIntentId({ payment_intent: { id: "pi_2" } })).toBe("pi_2")
    expect(stripeDisputePaymentIntentId({ payment_intent: null })).toBeNull()
  })
})

describe("buildQuestRewardSettledArgs", () => {
  const settlement = {
    bountyId: "bounty_1",
    demandPostId: "dp_1",
    milestoneIndex: 2,
    payoutAmount: 12.5,
    currencyCode: "USD",
  }

  it("maps a paid milestone to the quest.reward_settled args", () => {
    expect(buildQuestRewardSettledArgs({ userId: "bo_user_1", settlement })).toEqual({
      userId: "bo_user_1",
      grossCents: 1250,
      currency: "usd",
      fbmOrderId: "dp_1",
      questCompletionId: "bounty_1:m2",
      questId: "bounty_1",
    })
  })

  it("skips when the assignee has no Blackout identity (never leaks an FBM id)", () => {
    expect(buildQuestRewardSettledArgs({ userId: null, settlement })).toBeNull()
  })

  it("skips non-positive payouts", () => {
    expect(
      buildQuestRewardSettledArgs({
        userId: "bo_user_1",
        settlement: { ...settlement, payoutAmount: 0 },
      })
    ).toBeNull()
  })

  it("coerces string amounts (ledger major units) to rounded cents and defaults currency", () => {
    const args = buildQuestRewardSettledArgs({
      userId: "bo_user_1",
      settlement: { ...settlement, payoutAmount: "9.999", currencyCode: null },
    })
    expect(args?.grossCents).toBe(1000)
    expect(args?.currency).toBe("usd")
  })
})
