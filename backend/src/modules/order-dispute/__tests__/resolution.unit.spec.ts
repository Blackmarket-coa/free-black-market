import {
  DEFAULT_FILING_WINDOW_DAYS,
  DisputeStateError,
  DisputeStatus,
  assertDisputeTransition,
  canActorTransition,
  escrowTransitionFor,
  isAllowedDisputeTransition,
  isTerminal,
  isWithinFilingWindow,
  resolveAwardCents,
  resolveClaimCents,
} from "../resolution"

const at = (iso: string) => new Date(iso)

describe("order dispute: filing window", () => {
  const placed = at("2026-07-01T12:00:00Z")

  it("accepts a claim inside the window", () => {
    expect(
      isWithinFilingWindow({ orderPlacedAt: placed, now: at("2026-08-01T12:00:00Z") })
    ).toBe(true)
  })

  it("refuses one past the window", () => {
    expect(
      isWithinFilingWindow({ orderPlacedAt: placed, now: at("2026-10-01T12:00:00Z") })
    ).toBe(false)
  })

  it("uses a 60-day default", () => {
    expect(DEFAULT_FILING_WINDOW_DAYS).toBe(60)
    const lastMoment = new Date(
      placed.getTime() + DEFAULT_FILING_WINDOW_DAYS * 24 * 3600 * 1000
    )
    expect(isWithinFilingWindow({ orderPlacedAt: placed, now: lastMoment })).toBe(true)
    expect(
      isWithinFilingWindow({
        orderPlacedAt: placed,
        now: new Date(lastMoment.getTime() + 1),
      })
    ).toBe(false)
  })

  it("honours a custom window", () => {
    expect(
      isWithinFilingWindow({
        orderPlacedAt: placed,
        now: at("2026-10-01T12:00:00Z"),
        windowDays: 180,
      })
    ).toBe(true)
  })

  it("refuses an unparseable order date rather than allowing it forever", () => {
    expect(
      isWithinFilingWindow({ orderPlacedAt: "not-a-date", now: new Date() })
    ).toBe(false)
  })
})

describe("order dispute: claim amount", () => {
  it("defaults to the whole order", () => {
    // Saves a buyer restating a figure the platform already knows.
    expect(resolveClaimCents({ orderTotalCents: 12_500 })).toBe(12_500)
    expect(
      resolveClaimCents({ requestedCents: null, orderTotalCents: 12_500 })
    ).toBe(12_500)
  })

  it("honours a partial claim", () => {
    expect(
      resolveClaimCents({ requestedCents: 4_000, orderTotalCents: 12_500 })
    ).toBe(4_000)
  })

  it("clamps a claim larger than the order", () => {
    // A claim bigger than what was paid is a data error, not a position.
    expect(
      resolveClaimCents({ requestedCents: 99_999, orderTotalCents: 12_500 })
    ).toBe(12_500)
  })

  it("treats a zero or negative claim as the whole order", () => {
    expect(resolveClaimCents({ requestedCents: 0, orderTotalCents: 500 })).toBe(500)
    expect(resolveClaimCents({ requestedCents: -1, orderTotalCents: 500 })).toBe(500)
  })
})

describe("order dispute: award", () => {
  it("awards the full claim when a refund names no figure", () => {
    expect(
      resolveAwardCents({
        status: DisputeStatus.RESOLVED_REFUND,
        claimCents: 5_000,
      })
    ).toBe(5_000)
  })

  it("awards a partial refund", () => {
    expect(
      resolveAwardCents({
        status: DisputeStatus.RESOLVED_REFUND,
        awardCents: 2_000,
        claimCents: 5_000,
      })
    ).toBe(2_000)
  })

  it("refuses an award larger than the claim", () => {
    expect(() =>
      resolveAwardCents({
        status: DisputeStatus.RESOLVED_REFUND,
        awardCents: 6_000,
        claimCents: 5_000,
      })
    ).toThrow(DisputeStateError)
  })

  it("awards nothing on a release", () => {
    expect(
      resolveAwardCents({
        status: DisputeStatus.RESOLVED_RELEASE,
        claimCents: 5_000,
      })
    ).toBe(0)
  })

  it("REFUSES an award attached to a release rather than zeroing it", () => {
    // It means the resolver picked the wrong outcome; silently discarding the
    // number would hide that from everyone including the buyer.
    expect(() =>
      resolveAwardCents({
        status: DisputeStatus.RESOLVED_RELEASE,
        awardCents: 1_000,
        claimCents: 5_000,
      })
    ).toThrow(/release resolution awards nothing/)
  })
})

describe("order dispute: lifecycle", () => {
  it("allows the real path", () => {
    expect(
      isAllowedDisputeTransition(DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW)
    ).toBe(true)
    expect(
      isAllowedDisputeTransition(
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.RESOLVED_REFUND
      )
    ).toBe(true)
    expect(
      isAllowedDisputeTransition(DisputeStatus.OPEN, DisputeStatus.RESOLVED_RELEASE)
    ).toBe(true)
  })

  it("still allows withdrawal during review", () => {
    // Parties who settle it themselves should not have to wait for a ruling.
    expect(
      isAllowedDisputeTransition(
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.WITHDRAWN
      )
    ).toBe(true)
  })

  it("treats every ending as terminal", () => {
    for (const status of [
      DisputeStatus.RESOLVED_REFUND,
      DisputeStatus.RESOLVED_RELEASE,
      DisputeStatus.WITHDRAWN,
    ]) {
      expect(isTerminal(status)).toBe(true)
      expect(isAllowedDisputeTransition(status, DisputeStatus.OPEN)).toBe(false)
    }
  })
})

describe("order dispute: who may act", () => {
  it("lets only an admin resolve", () => {
    expect(canActorTransition("admin", DisputeStatus.RESOLVED_REFUND)).toBe(true)
    expect(canActorTransition("admin", DisputeStatus.RESOLVED_RELEASE)).toBe(true)
  })

  it("never lets a vendor close a dispute against themselves", () => {
    expect(canActorTransition("seller", DisputeStatus.RESOLVED_RELEASE)).toBe(false)
    expect(canActorTransition("seller", DisputeStatus.WITHDRAWN)).toBe(false)
    expect(canActorTransition("seller", DisputeStatus.UNDER_REVIEW)).toBe(false)
  })

  it("never lets a buyer rule in their own favour", () => {
    // A buyer who no longer wants the claim withdraws it — a different act
    // with a different record.
    expect(canActorTransition("buyer", DisputeStatus.RESOLVED_REFUND)).toBe(false)
    expect(canActorTransition("buyer", DisputeStatus.WITHDRAWN)).toBe(true)
  })

  it("rejects a legal transition made by the wrong actor", () => {
    expect(() =>
      assertDisputeTransition({
        from: DisputeStatus.OPEN,
        to: DisputeStatus.RESOLVED_RELEASE,
        actor: "seller",
      })
    ).toThrow(/may not move a dispute/)
  })

  it("rejects an illegal transition even from an admin", () => {
    expect(() =>
      assertDisputeTransition({
        from: DisputeStatus.WITHDRAWN,
        to: DisputeStatus.RESOLVED_REFUND,
        actor: "admin",
      })
    ).toThrow(/cannot move a dispute/)
  })
})

describe("order dispute: escrow linkage", () => {
  it("maps a resolution onto the escrow machine's own transitions", () => {
    expect(escrowTransitionFor(DisputeStatus.RESOLVED_RELEASE)).toBe(
      "resolve_dispute_release"
    )
    expect(escrowTransitionFor(DisputeStatus.RESOLVED_REFUND)).toBe("recover")
  })

  it("implies no escrow move for a non-resolution", () => {
    expect(escrowTransitionFor(DisputeStatus.OPEN)).toBeNull()
    expect(escrowTransitionFor(DisputeStatus.UNDER_REVIEW)).toBeNull()
    expect(escrowTransitionFor(DisputeStatus.WITHDRAWN)).toBeNull()
  })
})
