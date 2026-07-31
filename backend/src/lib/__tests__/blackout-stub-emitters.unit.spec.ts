import {
  buildQuestRewardSettledArgs,
  emitAmbassadorCommissionPaid,
  emitLedgerUsdcConverted,
  emitPurchaseChargebacked,
  emitPurchaseFailed,
  emitQuestRewardSettled,
  emitReferralAttributed,
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

  it("purchase.failed / purchase.chargebacked: eventId keyed by fbmOrderId", async () => {
    await emitPurchaseFailed(container, {
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "asset_bundle",
      fbmOrderId: "order_1",
    })
    await emitPurchaseChargebacked(container, {
      userId: "bo_user_1",
      providerListingId: "listing_1",
      kind: "asset_bundle",
      fbmOrderId: "order_1",
    })

    expect(emit).toHaveBeenNthCalledWith(
      1,
      container,
      "purchase.failed",
      { userId: "bo_user_1", providerListingId: "listing_1", sku: null, kind: "asset_bundle" },
      expect.objectContaining({ eventId: "purchase.failed:order_1" })
    )
    expect(emit).toHaveBeenNthCalledWith(
      2,
      container,
      "purchase.chargebacked",
      { userId: "bo_user_1", providerListingId: "listing_1", kind: "asset_bundle" },
      expect.objectContaining({ eventId: "purchase.chargebacked:order_1" })
    )
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
