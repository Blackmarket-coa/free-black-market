import { describe, expect, it } from "vitest"

import {
  daysRemaining,
  interpretAddonPurchase,
  type PurchaseAddonResponse,
} from "./vendor-addons"

const result = (
  over: {
    charge?: Partial<PurchaseAddonResponse["charge"]>
    execution?: Partial<PurchaseAddonResponse["execution"]>
    addon?: Partial<PurchaseAddonResponse["addon"]>
    replayed?: boolean
  } = {}
): PurchaseAddonResponse => ({
  charge: {
    id: "vc_1",
    status: "pending",
    amount: 4900,
    currency_code: "usd",
    ...over.charge,
  },
  execution: { executed: false, reason: null, ...over.execution },
  addon: {
    code: "quest_pack",
    active: false,
    expires_at: null,
    ...over.addon,
  },
  replayed: over.replayed ?? false,
})

describe("interpretAddonPurchase", () => {
  it("celebrates a paid charge", () => {
    const feedback = interpretAddonPurchase(
      result({ charge: { status: "paid" } })
    )
    expect(feedback.tone).toBe("success")
    expect(feedback.needsPaymentMethod).toBe(false)
  })

  it("treats an already-active pack as success even before the charge flips", () => {
    // Operator-comped or extended packs report active without a paid charge.
    const feedback = interpretAddonPurchase(result({ addon: { active: true } }))
    expect(feedback.tone).toBe("success")
  })

  it("routes a missing payment method to setup, not to a retry", () => {
    // The load-bearing distinction: "add a card first", not "try again".
    const feedback = interpretAddonPurchase(
      result({ execution: { reason: "no_payment_method" } })
    )
    expect(feedback.tone).toBe("info")
    expect(feedback.needsPaymentMethod).toBe(true)
  })

  it("explains a processing charge without promising access yet", () => {
    const feedback = interpretAddonPurchase(
      result({ charge: { status: "processing" } })
    )
    expect(feedback.tone).toBe("info")
    expect(feedback.needsPaymentMethod).toBe(false)
    expect(feedback.message).toMatch(/processing/i)
  })

  it("falls back to a retryable error for anything else", () => {
    const feedback = interpretAddonPurchase(
      result({
        charge: { status: "failed" },
        execution: { reason: "payment_failed" },
      })
    )
    expect(feedback.tone).toBe("error")
    expect(feedback.needsPaymentMethod).toBe(false)
  })
})

describe("daysRemaining", () => {
  const now = new Date("2026-08-01T00:00:00.000Z")

  it("counts whole days left on an active window", () => {
    expect(
      daysRemaining(
        {
          code: "quest_pack",
          active: true,
          expires_at: "2026-08-11T00:00:00.000Z",
        },
        now
      )
    ).toBe(10)
  })

  it("rounds a partial day up rather than down to zero", () => {
    // Hours left is not "out of days" — the vendor still has access today.
    expect(
      daysRemaining(
        {
          code: "quest_pack",
          active: true,
          expires_at: "2026-08-01T06:00:00.000Z",
        },
        now
      )
    ).toBe(1)
  })

  it("is null for an inactive pack", () => {
    expect(
      daysRemaining(
        {
          code: "quest_pack",
          active: false,
          expires_at: "2026-08-11T00:00:00.000Z",
        },
        now
      )
    ).toBeNull()
  })

  it("is null when the window has already closed", () => {
    expect(
      daysRemaining(
        {
          code: "quest_pack",
          active: true,
          expires_at: "2026-07-01T00:00:00.000Z",
        },
        now
      )
    ).toBeNull()
  })

  it("is null for a missing or unparseable expiry", () => {
    expect(
      daysRemaining({ code: "quest_pack", active: true, expires_at: null }, now)
    ).toBeNull()
    expect(
      daysRemaining(
        { code: "quest_pack", active: true, expires_at: "not-a-date" },
        now
      )
    ).toBeNull()
  })
})
