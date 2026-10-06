import {
  CHECKOUT_METADATA_MAX_KEYS,
  extractPaymentMethodId,
  extractStripeClientSecret,
  formatCheckoutPrice,
  mapListingRecurrence,
  navigatedFromOwnPage,
  parseAutoRenewAnswer,
  paymentSessionAnswer,
  paymentSessionApprovalVersion,
  paymentSessionKeepsCard,
  paymentSessionMayBePaid,
  sanitizeCheckoutMetadata,
} from "../blackout-checkout"
import { SubscriptionInterval } from "../../modules/subscription/types"

describe("sanitizeCheckoutMetadata — bounded checkout metadata echo", () => {
  it("keeps string→string pairs and drops everything else", () => {
    expect(
      sanitizeCheckoutMetadata({
        creatorSubscriptionId: "csub_1",
        tipId: "tip_2",
        count: 3,
        nested: { a: 1 },
        list: ["x"],
        nil: null,
      })
    ).toEqual({ creatorSubscriptionId: "csub_1", tipId: "tip_2" })
  })

  it("returns null for empty, non-object, or fully-invalid input", () => {
    expect(sanitizeCheckoutMetadata(null)).toBeNull()
    expect(sanitizeCheckoutMetadata(undefined)).toBeNull()
    expect(sanitizeCheckoutMetadata("str")).toBeNull()
    expect(sanitizeCheckoutMetadata([])).toBeNull()
    expect(sanitizeCheckoutMetadata({})).toBeNull()
    expect(sanitizeCheckoutMetadata({ a: 1 })).toBeNull()
  })

  it("caps the key count and drops over-long keys/values", () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < CHECKOUT_METADATA_MAX_KEYS + 10; i++) big[`k${i}`] = "v"
    const out = sanitizeCheckoutMetadata(big)
    expect(Object.keys(out!)).toHaveLength(CHECKOUT_METADATA_MAX_KEYS)

    expect(
      sanitizeCheckoutMetadata({
        ["x".repeat(65)]: "v",
        ok: "y",
        long: "v".repeat(501),
      })
    ).toEqual({ ok: "y" })
  })
})

describe("mapListingRecurrence — listing → subscription shape", () => {
  it("returns null for non-subscription categories", () => {
    expect(mapListingRecurrence({ category: "security-tool", interval: "monthly" })).toBeNull()
    expect(mapListingRecurrence({ category: null })).toBeNull()
    expect(mapListingRecurrence({})).toBeNull()
  })

  it("maps each interval with a ~1-year period horizon", () => {
    const table: Array<[string, SubscriptionInterval, number]> = [
      ["weekly", SubscriptionInterval.WEEKLY, 52],
      ["biweekly", SubscriptionInterval.BIWEEKLY, 26],
      ["monthly", SubscriptionInterval.MONTHLY, 12],
      ["quarterly", SubscriptionInterval.QUARTERLY, 4],
      ["yearly", SubscriptionInterval.YEARLY, 1],
    ]
    for (const [raw, interval, period] of table) {
      expect(
        mapListingRecurrence({ category: "subscription", interval: raw })
      ).toEqual({ interval, period })
    }
  })

  it("defaults a subscription listing with no/unknown interval to monthly", () => {
    expect(mapListingRecurrence({ category: "subscription" })).toEqual({
      interval: SubscriptionInterval.MONTHLY,
      period: 12,
    })
    expect(
      mapListingRecurrence({ category: "subscription", interval: "fortnightly" })
    ).toEqual({ interval: SubscriptionInterval.MONTHLY, period: 12 })
    expect(
      mapListingRecurrence({ category: "subscription", interval: "MONTHLY" })
    ).toEqual({ interval: SubscriptionInterval.MONTHLY, period: 12 })
  })
})

describe("extractStripeClientSecret — provider snapshot shapes", () => {
  it("reads top-level, camelCase, and nested locations", () => {
    expect(extractStripeClientSecret({ client_secret: "cs_a" })).toBe("cs_a")
    expect(extractStripeClientSecret({ clientSecret: "cs_b" })).toBe("cs_b")
    expect(extractStripeClientSecret({ data: { client_secret: "cs_c" } })).toBe("cs_c")
  })

  it("returns null for absent/invalid shapes", () => {
    expect(extractStripeClientSecret(null)).toBeNull()
    expect(extractStripeClientSecret("cs_x")).toBeNull()
    expect(extractStripeClientSecret({})).toBeNull()
    expect(extractStripeClientSecret({ client_secret: "" })).toBeNull()
  })
})

describe("extractPaymentMethodId — saved payment method for renewals", () => {
  it("reads a string id, an expanded object, and a nested snapshot", () => {
    expect(extractPaymentMethodId({ payment_method: "pm_1" })).toBe("pm_1")
    expect(extractPaymentMethodId({ payment_method: { id: "pm_2" } })).toBe("pm_2")
    expect(extractPaymentMethodId({ payment_method_id: "pm_3" })).toBe("pm_3")
    expect(extractPaymentMethodId({ data: { payment_method: "pm_4" } })).toBe("pm_4")
  })

  it("returns null when nothing usable is present", () => {
    expect(extractPaymentMethodId(null)).toBeNull()
    expect(extractPaymentMethodId({})).toBeNull()
    expect(extractPaymentMethodId({ payment_method: { id: 7 } })).toBeNull()
  })
})

describe("auto-renew answer helpers (FF_CONSUMER_SUBSCRIPTIONS_V1 hosted checkout)", () => {
  it("parseAutoRenewAnswer accepts exactly true/false, as booleans or their strings", () => {
    expect(parseAutoRenewAnswer(true)).toBe(true)
    expect(parseAutoRenewAnswer("true")).toBe(true)
    expect(parseAutoRenewAnswer(false)).toBe(false)
    expect(parseAutoRenewAnswer("false")).toBe(false)
    for (const raw of [undefined, null, "", "on", "1", 1, "TRUE", ["true"], ["false", "true"], {}]) {
      expect(parseAutoRenewAnswer(raw)).toBeNull()
    }
  })

  it("paymentSessionKeepsCard reads the provider's stored setup_future_usage", () => {
    expect(paymentSessionKeepsCard({ setup_future_usage: "off_session" })).toBe(true)
    expect(paymentSessionKeepsCard({ data: { setup_future_usage: "off_session" } })).toBe(true)
    expect(paymentSessionKeepsCard({ setup_future_usage: null })).toBe(false)
    expect(paymentSessionKeepsCard({ setup_future_usage: "on_session" })).toBe(false)
    expect(paymentSessionKeepsCard(null)).toBe(false)
    expect(paymentSessionKeepsCard("off_session")).toBe(false)
  })

  it("paymentSessionMayBePaid: authorized/captured, or an intent past confirmation", () => {
    expect(paymentSessionMayBePaid({ status: "authorized" })).toBe(true)
    expect(paymentSessionMayBePaid({ status: "captured" })).toBe(true)
    expect(paymentSessionMayBePaid({ status: "pending", data: { status: "succeeded" } })).toBe(true)
    expect(paymentSessionMayBePaid({ status: "pending", data: { status: "requires_capture" } })).toBe(true)
    expect(paymentSessionMayBePaid({ status: "pending", data: { status: "requires_payment_method" } })).toBe(false)
    expect(paymentSessionMayBePaid(null)).toBe(false)
  })

  it("formatCheckoutPrice names the per-period price in the currency", () => {
    expect(formatCheckoutPrice("5", "usd")).toBe("$5.00")
    expect(formatCheckoutPrice(12.5, "USD")).toBe("$12.50")
    expect(formatCheckoutPrice(null, "usd")).toBe("— USD")
    expect(formatCheckoutPrice("abc", null)).toBe("—")
  })
})

describe("the hosted checkout's approval evidence", () => {
  it("navigatedFromOwnPage: only a same-origin navigation counts; Fetch Metadata wins over Referer", () => {
    expect(navigatedFromOwnPage({ "sec-fetch-site": "same-origin" })).toBe(true)
    for (const site of ["cross-site", "same-site", "none", ""]) {
      expect(navigatedFromOwnPage({ "sec-fetch-site": site, referer: "https://api.fbm.test/x", host: "api.fbm.test" })).toBe(false)
    }
    // No Fetch Metadata: the Referer's host must be this host.
    expect(navigatedFromOwnPage({ referer: "https://api.fbm.test/page", host: "api.fbm.test" })).toBe(true)
    expect(navigatedFromOwnPage({ referer: "https://theblackout.app/vault", host: "api.fbm.test" })).toBe(false)
    expect(navigatedFromOwnPage({ referer: "not a url", host: "api.fbm.test" })).toBe(false)
    expect(navigatedFromOwnPage({ host: "api.fbm.test" })).toBe(false)
    expect(navigatedFromOwnPage({ "sec-fetch-site": ["same-origin"] })).toBe(false)
    expect(navigatedFromOwnPage({})).toBe(false)
    expect(navigatedFromOwnPage(undefined)).toBe(false)
  })

  it("paymentSessionAnswer reads the card setting and the approval mark back from the intent", () => {
    const approved = { setup_future_usage: "off_session", metadata: { fbm_auto_renew_disclosure_version: "v1" } }
    expect(paymentSessionApprovalVersion(approved)).toBe("v1")
    expect(paymentSessionApprovalVersion({ data: approved })).toBe("v1")
    expect(paymentSessionAnswer(approved)).toEqual({ kind: "approved", disclosure_version: "v1" })
    expect(paymentSessionAnswer({ setup_future_usage: "off_session" })).toEqual({ kind: "unasked" })
    expect(paymentSessionAnswer({ setup_future_usage: "off_session", metadata: { fbm_auto_renew_disclosure_version: "" } })).toEqual({ kind: "unasked" })
    // A mark without off-session setup keeps no card: declined.
    expect(paymentSessionAnswer({ setup_future_usage: null, metadata: { fbm_auto_renew_disclosure_version: "v1" } })).toEqual({ kind: "declined" })
    expect(paymentSessionAnswer(null)).toEqual({ kind: "declined" })
  })
})
