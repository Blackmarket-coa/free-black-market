import {
  buildReferralAttributedArgs,
  buildUsdcConvertedArgs,
  VENDOR_OWNER_TYPES,
} from "../blackout-wire-helpers"

describe("buildReferralAttributedArgs", () => {
  it("maps a held attribution to the referral.attributed payload", () => {
    const args = buildReferralAttributedArgs({
      userId: "bo_user_1",
      orderId: "order_1",
      attribution: {
        id: "attr_1",
        commission_amount_cents: 1234,
        currency_code: "USD",
      },
    })

    expect(args).toEqual({
      userId: "bo_user_1",
      grossCents: 1234,
      currency: "usd",
      fbmOrderId: "order_1",
      referralId: "attr_1",
    })
  })

  it("coerces string/float commission cents to a rounded integer and defaults currency", () => {
    const args = buildReferralAttributedArgs({
      userId: "bo_user_1",
      orderId: "order_1",
      attribution: { id: "attr_1", commission_amount_cents: "999.6", currency_code: null },
    })
    expect(args.grossCents).toBe(1000)
    expect(args.currency).toBe("usd")
  })
})

describe("buildUsdcConvertedArgs", () => {
  const entry = {
    id: "entry_1",
    order_id: "order_9",
    amount: 42.5,
    currency_code: "usd",
  }

  it("emits for a vendor-owned credit account with order context", () => {
    const args = buildUsdcConvertedArgs({
      entry,
      creditAccount: { owner_type: "SELLER", owner_id: "seller_1" },
      ledgerTxId: "stellar_tx_1",
    })

    expect(args).toEqual({
      vendorId: "seller_1",
      orderId: "order_9",
      amountMinorUnits: 4250,
      currency: "USD",
      ledgerTxId: "stellar_tx_1",
    })
  })

  it.each(VENDOR_OWNER_TYPES)("treats %s as a vendor owner", (ownerType) => {
    const args = buildUsdcConvertedArgs({
      entry,
      creditAccount: { owner_type: ownerType, owner_id: "owner_1" },
      ledgerTxId: "tx",
    })
    expect(args?.vendorId).toBe("owner_1")
  })

  it("skips entries with no order context", () => {
    expect(
      buildUsdcConvertedArgs({
        entry: { ...entry, order_id: null },
        creditAccount: { owner_type: "SELLER", owner_id: "seller_1" },
        ledgerTxId: "tx",
      })
    ).toBeNull()
  })

  it("skips non-vendor legs (platform/system/customer)", () => {
    for (const ownerType of ["PLATFORM", "SYSTEM", "CUSTOMER"]) {
      expect(
        buildUsdcConvertedArgs({
          entry,
          creditAccount: { owner_type: ownerType, owner_id: "x" },
          ledgerTxId: "tx",
        })
      ).toBeNull()
    }
  })

  it("skips when the credit account is missing or has no owner id", () => {
    expect(
      buildUsdcConvertedArgs({ entry, creditAccount: null, ledgerTxId: "tx" })
    ).toBeNull()
    expect(
      buildUsdcConvertedArgs({
        entry,
        creditAccount: { owner_type: "SELLER", owner_id: null },
        ledgerTxId: "tx",
      })
    ).toBeNull()
  })

  it("skips non-positive amounts", () => {
    expect(
      buildUsdcConvertedArgs({
        entry: { ...entry, amount: 0 },
        creditAccount: { owner_type: "SELLER", owner_id: "seller_1" },
        ledgerTxId: "tx",
      })
    ).toBeNull()
  })
})
