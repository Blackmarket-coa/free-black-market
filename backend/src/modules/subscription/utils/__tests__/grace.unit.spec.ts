import {
  cancelGraceStart,
  graceEndsAt,
  GRACE_PERIOD_ENV,
  GRACE_PERIOD_PRODUCT_METADATA_KEY,
  isGraceExpired,
  isUntilCanceledProduct,
  parseGraceDays,
  resolveGracePeriodDays,
} from "../grace"
import { renewalIdempotencyKey, renewalPeriodStart, toSmallestUnit } from "../renewal-charge"
import { SubscriptionInterval } from "../../types"

describe("grace length is a setting, never a constant", () => {
  it("names the env var and product key the operator sets", () => {
    expect(GRACE_PERIOD_ENV).toBe("SUBSCRIPTION_GRACE_PERIOD_DAYS")
    expect(GRACE_PERIOD_PRODUCT_METADATA_KEY).toBe("subscription_grace_period_days")
  })

  it("nothing configured → null, not a default number", () => {
    expect(resolveGracePeriodDays({})).toBeNull()
    expect(resolveGracePeriodDays({ product_metadata: {}, platform_default: undefined })).toBeNull()
    expect(resolveGracePeriodDays({ platform_default: "" })).toBeNull()
  })

  it("platform default from the env value", () => {
    expect(resolveGracePeriodDays({ platform_default: "14" })).toEqual({ days: 14, source: "platform" })
  })

  it("a per-product override beats the platform default", () => {
    expect(
      resolveGracePeriodDays({
        product_metadata: { subscription_grace_period_days: "3" },
        platform_default: "14",
      })
    ).toEqual({ days: 3, source: "product" })
    expect(
      resolveGracePeriodDays({ product_metadata: { subscription_grace_period_days: 5 } })
    ).toEqual({ days: 5, source: "product" })
  })

  it("a malformed override is ignored, falling back to the platform default", () => {
    expect(
      resolveGracePeriodDays({
        product_metadata: { subscription_grace_period_days: "two weeks" },
        platform_default: "14",
      })
    ).toEqual({ days: 14, source: "platform" })
  })

  it.each([["-1"], ["1.5"], [-3], [2.5], ["abc"], [true], [{}]])(
    "parseGraceDays(%p) is not configured",
    (raw) => {
      expect(parseGraceDays(raw)).toBeNull()
    }
  )

  it("zero is a configured value (no grace)", () => {
    expect(parseGraceDays("0")).toBe(0)
    expect(parseGraceDays(0)).toBe(0)
  })
})

describe("grace arithmetic", () => {
  const now = new Date("2026-10-04T12:00:00.000Z")

  it("graceEndsAt adds whole days", () => {
    expect(graceEndsAt(now, 7).toISOString()).toBe("2026-10-11T12:00:00.000Z")
  })

  it("a cancel's grace starts at the end of the paid period when that is in the future", () => {
    const paid = new Date("2026-10-20T00:00:00.000Z")
    expect(cancelGraceStart(paid, now)).toEqual(paid)
  })

  it("…and at now when the paid period is past or unknown", () => {
    expect(cancelGraceStart(new Date("2026-09-01T00:00:00.000Z"), now)).toEqual(now)
    expect(cancelGraceStart(null, now)).toEqual(now)
  })

  it("grace is expired at and after grace_ends_at only", () => {
    expect(isGraceExpired(now, now)).toBe(true)
    expect(isGraceExpired(new Date(now.getTime() + 1), now)).toBe(false)
    expect(isGraceExpired(null, now)).toBe(false)
  })

  it("until-canceled opt-in reads true or the string 'true' only", () => {
    expect(isUntilCanceledProduct({ subscription_until_canceled: true })).toBe(true)
    expect(isUntilCanceledProduct({ subscription_until_canceled: "true" })).toBe(true)
    expect(isUntilCanceledProduct({ subscription_until_canceled: "yes" })).toBe(false)
    expect(isUntilCanceledProduct(null)).toBe(false)
  })
})

describe("renewal charge (pure)", () => {
  it("period start is one interval after last_order_date", () => {
    expect(
      renewalPeriodStart(new Date("2026-09-01T00:00:00.000Z"), SubscriptionInterval.MONTHLY).toISOString()
    ).toBe("2026-10-01T00:00:00.000Z")
  })

  it("idempotency key is derived from the record: subscription id + period start", () => {
    expect(
      renewalIdempotencyKey({
        subscription_id: "sub_1",
        period_start: new Date("2026-10-01T00:00:00.000Z"),
      })
    ).toBe("subscription-renewal:sub_1:2026-10-01T00:00:00.000Z")
  })

  it("amounts become integer smallest units", () => {
    expect(toSmallestUnit(19.99, "usd")).toBe(1999)
    expect(toSmallestUnit("10", "USD")).toBe(1000)
    expect(toSmallestUnit(500, "jpy")).toBe(500)
    expect(Number.isInteger(toSmallestUnit(0.1 + 0.2, "usd"))).toBe(true)
  })
})
