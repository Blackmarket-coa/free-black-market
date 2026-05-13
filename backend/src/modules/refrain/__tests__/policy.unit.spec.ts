import {
  BOUNTY_PRICING_MODES,
  BOUNTY_RIGHTS_MODES,
  BOUNTY_STATUSES,
  BOUNTY_TRANSITIONS,
  canTransition,
  COMPETITIVE_HONORARIUM_PERCENT,
  computeHonorariumMinor,
  isBountyStatus,
  MAX_REVIEW_WINDOW_DAYS,
  validateBountyCreate,
} from "../policy"

describe("refrain policy: status taxonomy", () => {
  it("exposes the eight canonical bounty statuses in stable order", () => {
    expect(BOUNTY_STATUSES).toEqual([
      "draft",
      "posted",
      "claimed",
      "submitted",
      "accepted",
      "rejected",
      "expired",
      "cancelled",
    ])
  })

  it.each(BOUNTY_STATUSES)("isBountyStatus accepts %s", (s) => {
    expect(isBountyStatus(s)).toBe(true)
  })

  it.each(["DRAFT", "Posted", "", null, undefined, 1])(
    "isBountyStatus rejects %p",
    (v) => {
      expect(isBountyStatus(v)).toBe(false)
    }
  )
})

describe("refrain policy: transition map", () => {
  it("draft can only become posted or cancelled", () => {
    expect(canTransition("draft", "posted")).toBe(true)
    expect(canTransition("draft", "cancelled")).toBe(true)
    expect(canTransition("draft", "claimed")).toBe(false)
  })

  it("posted can become claimed, cancelled, or expired", () => {
    expect(canTransition("posted", "claimed")).toBe(true)
    expect(canTransition("posted", "cancelled")).toBe(true)
    expect(canTransition("posted", "expired")).toBe(true)
    expect(canTransition("posted", "accepted")).toBe(false)
  })

  it("submitted can only resolve to accepted or rejected", () => {
    expect(canTransition("submitted", "accepted")).toBe(true)
    expect(canTransition("submitted", "rejected")).toBe(true)
    expect(canTransition("submitted", "claimed")).toBe(false)
    expect(canTransition("submitted", "expired")).toBe(false)
  })

  it("terminal states cannot transition further", () => {
    for (const terminal of ["accepted", "rejected", "expired", "cancelled"] as const) {
      expect(BOUNTY_TRANSITIONS[terminal]).toEqual([])
      for (const s of BOUNTY_STATUSES) {
        expect(canTransition(terminal, s)).toBe(false)
      }
    }
  })
})

describe("refrain policy: validateBountyCreate", () => {
  const baseValid = {
    title: "Make me a logo",
    amount_minor: 50_000,
    currency_code: "usd",
    pricing_mode: "fixed",
    rights_mode: "creator_retains",
    review_window_days: 7,
  }

  it("passes a minimal valid bounty (normalising currency to uppercase)", () => {
    const out = validateBountyCreate(baseValid)
    expect(out.currency_code).toBe("USD")
    expect(out.title).toBe("Make me a logo")
    expect(out.description).toBeNull()
  })

  it.each([
    { ...baseValid, title: "" },
    { ...baseValid, title: "   " },
    { ...baseValid, amount_minor: 0 },
    { ...baseValid, amount_minor: -1 },
    { ...baseValid, amount_minor: 12.5 },
    { ...baseValid, currency_code: "" },
    { ...baseValid, pricing_mode: "auction" },
    { ...baseValid, rights_mode: "transfer_to_poster" },
    { ...baseValid, review_window_days: 0 },
    { ...baseValid, review_window_days: MAX_REVIEW_WINDOW_DAYS + 1 },
  ])("rejects invalid bounty input %p", (bad) => {
    expect(() => validateBountyCreate(bad)).toThrow()
  })

  it("rejects non-object input", () => {
    expect(() => validateBountyCreate(null)).toThrow()
    expect(() => validateBountyCreate("hello")).toThrow()
  })

  it("trims title and description", () => {
    const out = validateBountyCreate({
      ...baseValid,
      title: "  Title with whitespace  ",
      description: "  trim me  ",
    })
    expect(out.title).toBe("Title with whitespace")
    expect(out.description).toBe("trim me")
  })

  it("only accepts the documented pricing/rights modes", () => {
    expect(BOUNTY_PRICING_MODES).toEqual(["fixed", "competitive"])
    expect(BOUNTY_RIGHTS_MODES).toEqual([
      "creator_retains",
      "shared_attribution",
      "license_to_poster",
    ])
  })
})

describe("refrain policy: computeHonorariumMinor", () => {
  it("pays a 10% pool split evenly across losing proposals", () => {
    // 100_000 cents * 10% = 10_000; / 4 proposals = 2_500 each
    expect(computeHonorariumMinor(100_000, 4)).toBe(2_500)
  })

  it("rounds down per-proposal (no fractional cents)", () => {
    // 99_999 * 10% = 9_999.9 -> floor 9_999; / 3 = 3_333
    expect(computeHonorariumMinor(99_999, 3)).toBe(3_333)
  })

  it("returns 0 for degenerate inputs", () => {
    expect(computeHonorariumMinor(0, 5)).toBe(0)
    expect(computeHonorariumMinor(100_000, 0)).toBe(0)
    expect(computeHonorariumMinor(-100, 3)).toBe(0)
    expect(computeHonorariumMinor(100_000, -1)).toBe(0)
    expect(computeHonorariumMinor(NaN, 5)).toBe(0)
  })

  it("the configured honorarium percent is 10 (intentional)", () => {
    expect(COMPETITIVE_HONORARIUM_PERCENT).toBe(10)
  })
})
