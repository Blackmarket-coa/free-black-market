import {
  CHECKOUT_METADATA_MAX_KEYS,
  extractPaymentMethodId,
  extractStripeClientSecret,
  mapListingRecurrence,
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
