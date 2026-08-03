import { describe, expect, it } from "vitest"

import { interpretPurchase, type PurchasePromotionResponse } from "./vendor-billing"

const result = (
  over: Partial<PurchasePromotionResponse> & {
    charge?: Partial<PurchasePromotionResponse["charge"]>
    execution?: Partial<PurchasePromotionResponse["execution"]>
    promotion?: Partial<PurchasePromotionResponse["promotion"]>
  } = {}
): PurchasePromotionResponse => ({
  charge: {
    id: "vc_1",
    status: "pending",
    amount: 1500,
    currency_code: "usd",
    ...over.charge,
  },
  execution: { executed: false, reason: null, ...over.execution },
  promotion: { active: false, expires_at: null, ...over.promotion },
  replayed: over.replayed ?? false,
})

describe("interpretPurchase", () => {
  it("celebrates a paid charge", () => {
    const feedback = interpretPurchase(result({ charge: { status: "paid" } }))
    expect(feedback.tone).toBe("success")
    expect(feedback.needsPaymentMethod).toBe(false)
  })

  it("treats an active promotion as success even before the charge flips", () => {
    // Operator-comped or already-live promotions report active without a paid
    // charge; the vendor should still see success.
    const feedback = interpretPurchase(result({ promotion: { active: true } }))
    expect(feedback.tone).toBe("success")
  })

  it("routes a missing payment method to setup, not to a retry", () => {
    // The load-bearing distinction: this is not a failure to retry, it is
    // "add a card first". The UI sends them to the form.
    const feedback = interpretPurchase(
      result({ execution: { reason: "no_payment_method" } })
    )
    expect(feedback.tone).toBe("info")
    expect(feedback.needsPaymentMethod).toBe(true)
  })

  it("explains a processing charge without promising placement yet", () => {
    const feedback = interpretPurchase(
      result({ charge: { status: "processing" } })
    )
    expect(feedback.tone).toBe("info")
    expect(feedback.needsPaymentMethod).toBe(false)
    expect(feedback.message).toMatch(/processing/i)
  })

  it("falls back to a retryable error for anything else", () => {
    const feedback = interpretPurchase(
      result({ charge: { status: "failed" }, execution: { reason: "payment_failed" } })
    )
    expect(feedback.tone).toBe("error")
    expect(feedback.needsPaymentMethod).toBe(false)
  })
})
