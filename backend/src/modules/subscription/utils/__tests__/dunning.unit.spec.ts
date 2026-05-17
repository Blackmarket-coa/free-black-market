import {
  decideDunningAction,
  DEFAULT_DUNNING_MAX_ATTEMPTS,
  DEFAULT_DUNNING_RETRY_DAYS,
} from "../dunning"

describe("decideDunningAction", () => {
  const FIXED_NOW = new Date("2026-05-07T00:00:00.000Z")
  const oneDayMs = 24 * 60 * 60 * 1000

  it("schedules a retry on the first attempt using the first backoff slot", () => {
    const decision = decideDunningAction({
      attempts: 1,
      now: FIXED_NOW,
      error: "card_declined",
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind !== "retry") return
    expect(decision.days).toBe(DEFAULT_DUNNING_RETRY_DAYS[0])
    expect(decision.next_retry_at.getTime()).toBe(
      FIXED_NOW.getTime() + DEFAULT_DUNNING_RETRY_DAYS[0] * oneDayMs
    )
  })

  it("schedules retries 1, 3, 7 days out for attempts 1, 2, 3-of-4", () => {
    // The default max is 3 — to exercise the third backoff slot we lift
    // the max to 4 so we can still see a retry on attempt 3.
    const overrides = { max_attempts: 4, now: FIXED_NOW }

    const a1 = decideDunningAction({ attempts: 1, ...overrides })
    const a2 = decideDunningAction({ attempts: 2, ...overrides })
    const a3 = decideDunningAction({ attempts: 3, ...overrides })

    expect([a1.kind, a2.kind, a3.kind]).toEqual(["retry", "retry", "retry"])
    if (a1.kind !== "retry" || a2.kind !== "retry" || a3.kind !== "retry") {
      return
    }
    expect([a1.days, a2.days, a3.days]).toEqual([1, 3, 7])
  })

  it("pauses once attempts reach the configured max", () => {
    const decision = decideDunningAction({
      attempts: DEFAULT_DUNNING_MAX_ATTEMPTS,
      now: FIXED_NOW,
      error: "card_declined",
    })

    expect(decision.kind).toBe("pause")
    if (decision.kind !== "pause") return
    expect(decision.reason).toContain("payment_failed_after_3_attempts")
    expect(decision.reason).toContain("card_declined")
  })

  it("uses the last backoff slot for attempts beyond the schedule length", () => {
    const decision = decideDunningAction({
      attempts: 7,
      max_attempts: 10,
      retry_days: [1, 3, 7],
      now: FIXED_NOW,
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind !== "retry") return
    expect(decision.days).toBe(7)
  })

  it("falls back to defaults when retry_days is empty", () => {
    const decision = decideDunningAction({
      attempts: 1,
      retry_days: [],
      now: FIXED_NOW,
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind !== "retry") return
    expect(decision.days).toBe(DEFAULT_DUNNING_RETRY_DAYS[0])
  })

  it("formats the pause reason with the unknown error sentinel when error is null", () => {
    const decision = decideDunningAction({
      attempts: 5,
      max_attempts: 3,
      now: FIXED_NOW,
      error: null,
    })

    expect(decision.kind).toBe("pause")
    if (decision.kind !== "pause") return
    expect(decision.reason).toContain("unknown")
  })
})
