import {
  RESEND_TESTING_SENDER,
  bareEmailAddress,
  isResendTestingDomain,
  resendSender,
} from "../resend-sender"

describe("resendSender", () => {
  it("reads RESEND_FROM_EMAIL", () => {
    expect(resendSender({ RESEND_FROM_EMAIL: "noreply@fbm.example" })).toBe("noreply@fbm.example")
  })

  it("reads RESEND_FROM, the name the production template used, when RESEND_FROM_EMAIL is unset", () => {
    expect(resendSender({ RESEND_FROM: "Free Black Market <noreply@fbm.example>" })).toBe(
      "Free Black Market <noreply@fbm.example>"
    )
  })

  it("prefers RESEND_FROM_EMAIL when both are set", () => {
    expect(
      resendSender({ RESEND_FROM_EMAIL: "a@fbm.example", RESEND_FROM: "b@fbm.example" })
    ).toBe("a@fbm.example")
  })

  it("skips blank and stringified-empty values", () => {
    expect(resendSender({ RESEND_FROM_EMAIL: "  ", RESEND_FROM: "b@fbm.example" })).toBe("b@fbm.example")
    expect(resendSender({ RESEND_FROM_EMAIL: "undefined", RESEND_FROM: "null" })).toBe(
      RESEND_TESTING_SENDER
    )
  })

  it("falls back to Resend's testing address when neither is set", () => {
    expect(resendSender({})).toBe("onboarding@resend.dev")
  })
})

describe("isResendTestingDomain", () => {
  it.each([
    ["onboarding@resend.dev", true],
    ["Free Black Market <onboarding@resend.dev>", true],
    ["  staging@RESEND.DEV ", true],
    ["noreply@fbm.example", false],
    ["Free Black Market <noreply@fbm.example>", false],
    ["resend.dev@fbm.example", false],
  ])("%s -> %s", (from, expected) => {
    expect(isResendTestingDomain(from)).toBe(expected)
  })
})

describe("bareEmailAddress", () => {
  it.each([
    ["Free Black Market <noreply@fbm.example>", "noreply@fbm.example"],
    ["noreply@fbm.example", "noreply@fbm.example"],
    ["  Name < noreply@fbm.example >  ", "noreply@fbm.example"],
    ["onboarding@resend.dev", "onboarding@resend.dev"],
  ])("%s -> %s", (from, expected) => {
    expect(bareEmailAddress(from)).toBe(expected)
  })
})
