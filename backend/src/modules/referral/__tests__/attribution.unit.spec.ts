import {
  ReferralStatus,
  REFERRAL_EARNING_WINDOW_DAYS,
  referralExpiryFrom,
  isReferralEarning,
  isValidAttribution,
} from "../attribution"

const day = 24 * 60 * 60 * 1000

describe("referralExpiryFrom", () => {
  it("adds the earning window to the attribution moment", () => {
    const at = new Date("2026-01-01T00:00:00.000Z")
    const expiry = referralExpiryFrom(at)
    expect(expiry.getTime() - at.getTime()).toBe(
      REFERRAL_EARNING_WINDOW_DAYS * day
    )
  })
})

describe("isValidAttribution", () => {
  it("accepts two distinct sellers", () => {
    expect(isValidAttribution("sel_referred", "sel_referrer")).toBe(true)
  })

  it("rejects a self-referral", () => {
    expect(isValidAttribution("sel_1", "sel_1")).toBe(false)
  })

  it("rejects missing ids", () => {
    expect(isValidAttribution("", "sel_1")).toBe(false)
    expect(isValidAttribution("sel_1", "")).toBe(false)
  })
})

describe("isReferralEarning", () => {
  const base = {
    status: ReferralStatus.ACTIVE,
    referrer_seller_id: "sel_referrer",
    referred_seller_id: "sel_referred",
    expires_at: new Date("2026-06-01T00:00:00.000Z"),
  }
  const before = new Date("2026-05-31T00:00:00.000Z")
  const after = new Date("2026-06-02T00:00:00.000Z")

  it("earns inside an active, unexpired window", () => {
    expect(isReferralEarning(base, before)).toBe(true)
  })

  it("stops earning the instant the window closes, before any cron runs", () => {
    // Still ACTIVE, but past expiry — the auto-lapse is evaluated here, not
    // trusted from the stored status.
    expect(isReferralEarning(base, after)).toBe(false)
  })

  it("treats expiry as inclusive of its exact instant", () => {
    expect(isReferralEarning(base, new Date(base.expires_at))).toBe(false)
  })

  it("earns forever when expires_at is null (operator grant)", () => {
    const grant = { ...base, expires_at: null }
    expect(isReferralEarning(grant, new Date("2999-01-01T00:00:00.000Z"))).toBe(
      true
    )
  })

  it("does not earn once expired or revoked", () => {
    expect(isReferralEarning({ ...base, status: ReferralStatus.EXPIRED }, before)).toBe(
      false
    )
    expect(isReferralEarning({ ...base, status: ReferralStatus.REVOKED }, before)).toBe(
      false
    )
  })

  it("never earns on a self-referral even if a row slipped past the guard", () => {
    const self = { ...base, referrer_seller_id: "sel_referred" }
    expect(isReferralEarning(self, before)).toBe(false)
  })

  it("accepts an ISO string expires_at (as read back from the row)", () => {
    const asString = { ...base, expires_at: base.expires_at.toISOString() }
    expect(isReferralEarning(asString, before)).toBe(true)
    expect(isReferralEarning(asString, after)).toBe(false)
  })
})
