import { describe, expect, it } from "vitest"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  autoRenewDisclosure,
  autoRenewState,
  chargeSummary,
  graceDaysOf,
  gracePolicyTerms,
  oneTimeTerms,
  paymentSessionDataFor,
  paymentSessionInitArgs,
  reapprovalDisclosure,
  subscribableInterval,
  subscribeSubmission,
  subscriptionCheckoutOf,
} from "@/lib/subscriptions/auto-renew"

const line = [{ variant_id: "variant_1", quantity: 1 }]
const approvedCart = {
  items: line,
  metadata: {
    subscription_checkout: {
      interval: "monthly",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      variant_id: "variant_1",
    },
  },
}
const declinedCart = {
  items: line,
  metadata: {
    subscription_checkout: {
      interval: "monthly",
      auto_renew_approved: false,
      auto_renew_disclosure_version: null,
      variant_id: "variant_1",
    },
  },
}

describe("subscribableInterval", () => {
  it("needs the marker AND a known interval", () => {
    expect(
      subscribableInterval({ metadata: { subscription_until_canceled: true, subscription_interval: "monthly" } })
    ).toBe("monthly")
    expect(
      subscribableInterval({ metadata: { subscription_until_canceled: "true", subscription_interval: "yearly" } })
    ).toBe("yearly")
    expect(subscribableInterval({ metadata: { subscription_interval: "monthly" } })).toBeNull()
    expect(
      subscribableInterval({ metadata: { subscription_until_canceled: true, subscription_interval: "daily" } })
    ).toBeNull()
    expect(subscribableInterval(null)).toBeNull()
  })
})

describe("disclosure copy", () => {
  it("names the price, the interval and how to stop it", () => {
    const text = autoRenewDisclosure({ price: "$10.00", interval: "monthly" })
    expect(text).toContain("$10.00")
    expect(text).toContain("renews every month until you cancel")
    expect(text).toContain("Account → Subscriptions")
    expect(oneTimeTerms({ price: "$10.00", interval: "monthly" })).toContain(
      "nothing charges you again unless you choose to"
    )
  })
})

describe("the checkbox decides the approval", () => {
  it("unticked: declined, no version", () => {
    expect(subscribeSubmission({ interval: "monthly", autoRenewTicked: false })).toEqual({
      interval: "monthly",
      auto_renew_approved: false,
      auto_renew_disclosure_version: null,
    })
  })
  it("ticked: approved with the current disclosure version", () => {
    expect(subscribeSubmission({ interval: "monthly", autoRenewTicked: true })).toEqual({
      interval: "monthly",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
  })
})

describe("the card is kept only for an approved subscription cart", () => {
  it("approved subscription cart: off-session setup", () => {
    expect(paymentSessionDataFor(approvedCart, true)).toEqual({ setup_future_usage: "off_session" })
  })
  it("declined subscription cart, ordinary cart: nothing extra", () => {
    expect(paymentSessionDataFor(declinedCart, true)).toBeUndefined()
    expect(paymentSessionDataFor({ metadata: {} }, true)).toBeUndefined()
    expect(paymentSessionDataFor(null, true)).toBeUndefined()
  })
  it("flag off: nothing, even for an approved subscription cart", () => {
    expect(subscriptionCheckoutOf(approvedCart, false)).toBeNull()
    expect(paymentSessionDataFor(approvedCart, false)).toBeUndefined()
  })
  it("the answer counts only while the cart is still the subscribe step's one line", () => {
    expect(subscriptionCheckoutOf(approvedCart, true)).toEqual({
      interval: "monthly",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    // Stale answer on a cart whose line was replaced by an ordinary product.
    expect(subscriptionCheckoutOf({ ...approvedCart, items: [{ variant_id: "variant_other", quantity: 1 }] }, true)).toBeNull()
    // A second line added, or the quantity raised.
    expect(subscriptionCheckoutOf({ ...approvedCart, items: [...line, { variant_id: "variant_2", quantity: 1 }] }, true)).toBeNull()
    expect(subscriptionCheckoutOf({ ...approvedCart, items: [{ variant_id: "variant_1", quantity: 2 }] }, true)).toBeNull()
    // An answer written without its variant.
    const { variant_id: _v, ...noVariant } = approvedCart.metadata.subscription_checkout
    expect(subscriptionCheckoutOf({ items: line, metadata: { subscription_checkout: noVariant } }, true)).toBeNull()
    // …and none of those gets off-session card setup.
    expect(paymentSessionDataFor({ ...approvedCart, items: [{ variant_id: "variant_other", quantity: 1 }] }, true)).toBeUndefined()
  })

  it("malformed metadata is not a subscription checkout", () => {
    expect(
      subscriptionCheckoutOf({ items: line, metadata: { subscription_checkout: { interval: "monthly", auto_renew_approved: "true", variant_id: "variant_1" } } }, true)
    ).toBeNull()
  })
})

describe("autoRenewState", () => {
  const now = new Date("2026-10-10T00:00:00.000Z")
  it("until cancelled → on", () => {
    expect(autoRenewState({ id: "s", status: "active", interval: "monthly", expiration_date: null }, now)).toEqual({
      kind: "on",
    })
  })
  it("one period with a saved card and time left → may be turned on", () => {
    expect(
      autoRenewState(
        {
          id: "s",
          status: "active",
          interval: "monthly",
          next_order_date: null,
          expiration_date: "2026-11-01T00:00:00.000Z",
          payment_method_id: "pm_1",
        },
        now
      )
    ).toEqual({ kind: "off_can_approve" })
  })
  it("no saved card, or the period is over → off, no toggle", () => {
    const base = {
      id: "s",
      status: "active",
      interval: "monthly" as const,
      next_order_date: null,
      expiration_date: "2026-11-01T00:00:00.000Z",
    }
    expect(autoRenewState(base, now)).toEqual({ kind: "off" })
    expect(
      autoRenewState({ ...base, payment_method_id: "pm_1", expiration_date: "2026-10-01T00:00:00.000Z" }, now)
    ).toEqual({ kind: "off" })
  })
})

describe("payment session (re)initiation", () => {
  const OFF = { setup_future_usage: "off_session" as const }

  it("flag off / ordinary cart: exactly the old rule — only a provider change initiates", () => {
    const sessionData = paymentSessionDataFor(approvedCart, false)
    expect(sessionData).toBeUndefined()
    expect(
      paymentSessionInitArgs({ activeSession: { provider_id: "pp_stripe", data: {} }, selectedProviderId: "pp_stripe", sessionData })
    ).toBeNull()
    expect(
      paymentSessionInitArgs({ activeSession: { provider_id: "pp_system", data: {} }, selectedProviderId: "pp_stripe", sessionData })
    ).toEqual({ provider_id: "pp_stripe" })
    expect(paymentSessionInitArgs({ activeSession: undefined, selectedProviderId: "pp_stripe", sessionData })).toEqual({
      provider_id: "pp_stripe",
    })
  })

  it("approved subscription cart: the off-session data is passed on a new session", () => {
    const sessionData = paymentSessionDataFor(approvedCart, true)
    expect(paymentSessionInitArgs({ activeSession: undefined, selectedProviderId: "pp_stripe", sessionData })).toEqual({
      provider_id: "pp_stripe",
      data: OFF,
    })
  })

  it("approved subscription cart: a reused session without off-session setup is re-initiated", () => {
    const sessionData = paymentSessionDataFor(approvedCart, true)
    expect(
      paymentSessionInitArgs({ activeSession: { provider_id: "pp_stripe", data: { id: "pi_1" } }, selectedProviderId: "pp_stripe", sessionData })
    ).toEqual({ provider_id: "pp_stripe", data: OFF })
    expect(
      paymentSessionInitArgs({
        activeSession: { provider_id: "pp_stripe", data: { id: "pi_1", setup_future_usage: "off_session" } },
        selectedProviderId: "pp_stripe",
        sessionData,
      })
    ).toBeNull()
  })
})

describe("grace / cancel copy says only what the backend does", () => {
  it("no grace length visible: no grace, read-only or export promise; cancelling may end access sooner", () => {
    const text = gracePolicyTerms(null)
    expect(text).toContain("keeps your access until the end of the period you have paid for")
    expect(text).toContain("can end your access sooner")
    expect(text).not.toMatch(/read-only|export|grace|nothing is deleted/i)
  })
  it("a product grace length: the days are named, and read-only — never export", () => {
    const text = gracePolicyTerms(14)
    expect(text).toContain("plus 14 days")
    expect(text).toContain("14 days more")
    expect(text).toContain("read-only")
    expect(text).not.toMatch(/export|sign in/i)
    expect(gracePolicyTerms(0)).not.toContain("0 day")
  })
  it("graceDaysOf reads only a valid product value", () => {
    expect(graceDaysOf({ metadata: { subscription_grace_period_days: "7" } })).toBe(7)
    expect(graceDaysOf({ metadata: { subscription_grace_period_days: -1 } })).toBeNull()
    expect(graceDaysOf({ metadata: {} })).toBeNull()
  })
  it("the purchase disclosure no longer claims the card is kept 'only' for renewals", () => {
    expect(autoRenewDisclosure({ price: "$10.00", interval: "monthly" })).not.toContain("only for these renewals")
  })
  it("the re-approval disclosure charges nothing today and names the saved card and the date", () => {
    const text = reapprovalDisclosure({ price: "$10.00", interval: "monthly", paidThrough: "Nov 1, 2026" })
    expect(text).toContain("Nothing is charged today")
    expect(text).toContain("card already saved for this subscription")
    expect(text).toContain("Nov 1, 2026")
    expect(text).not.toContain("you pay with today")
  })
})

describe("chargeSummary: never 'no further charges' while one is scheduled", () => {
  const fmt = (v?: string | null) => (v ? v.slice(0, 10) : null)
  it("grace after failed payments with a final charge scheduled", () => {
    const out = chargeSummary(
      { id: "s", status: "past_due", interval: "monthly", expiration_date: null, next_order_date: "2026-10-20T00:00:00.000Z", grace_ends_at: "2026-10-20T00:00:00.000Z" },
      fmt
    )
    expect(out.charge).toBe("Final payment attempt: 2026-10-20. Cancel to stop it.")
    expect(out.autoRenew).not.toBe("Automatic renewal: off")
  })
  it("cancelled during grace: no further charges, full access to grace end", () => {
    const out = chargeSummary(
      { id: "s", status: "past_due", interval: "monthly", expiration_date: null, next_order_date: null, grace_ends_at: "2026-10-20T00:00:00.000Z" },
      fmt
    )
    expect(out.charge).toBe("No further charges. Full access ends 2026-10-20.")
  })
  it("paused by the dunning loop: a final attempt may still come", () => {
    const out = chargeSummary(
      { id: "s", status: "paused", interval: "monthly", expiration_date: null, next_order_date: null, metadata: { paused_reason: "payment_failed_after_3_attempts" } },
      fmt
    )
    expect(out.charge).not.toContain("No further charges")
    expect(out.charge).toContain("cancel to stop it")
  })
  it("a voluntary pause: nothing while paused", () => {
    const out = chargeSummary({ id: "s", status: "paused", interval: "monthly", expiration_date: null, next_order_date: null }, fmt)
    expect(out.charge).toBe("No charges while paused.")
  })
  it("renewing: the next charge date", () => {
    const out = chargeSummary(
      { id: "s", status: "active", interval: "monthly", expiration_date: null, next_order_date: "2026-11-01T00:00:00.000Z" },
      fmt,
      new Date("2026-10-10T00:00:00.000Z")
    )
    expect(out).toEqual({ charge: "Next charge: 2026-11-01", autoRenew: "Automatic renewal: on" })
  })
})
