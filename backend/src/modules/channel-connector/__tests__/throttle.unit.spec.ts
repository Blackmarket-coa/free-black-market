import {
  CHANNEL_RATE_POLICIES,
  DEFAULT_RATE_POLICY,
  classifyFailure,
  clearedThrottle,
  decideThrottle,
  minRequestSpacingMs,
  nextRequestAt,
  parseRetryAfter,
  ratePolicyFor,
  shouldAttemptNow,
  type ChannelRatePolicy,
  type ThrottleState,
} from "../throttle"

/**
 * Phase 12 exists because, before it, the cron schedule was the only thing
 * limiting how hard FBM hit a channel. These cover the ways that fails: a
 * backoff shorter than the schedule, a `Retry-After` we shortened, a dead token
 * retried forever, and one malformed request pausing everything else.
 */

const policy: ChannelRatePolicy = {
  requests_per_minute: 60,
  base_backoff_ms: 60_000,
  max_backoff_ms: 3_600_000,
  auth_backoff_ms: 12 * 60 * 60 * 1000,
}

const now = new Date("2026-08-04T12:00:00.000Z")
const fresh = (): ThrottleState => clearedThrottle()

describe("classifyFailure", () => {
  it("separates the four kinds, because each needs a different answer", () => {
    expect(classifyFailure(429)).toBe("rate_limited")
    expect(classifyFailure(401)).toBe("auth")
    expect(classifyFailure(403)).toBe("auth")
    expect(classifyFailure(503)).toBe("transient")
    // `ChannelApiError` uses 0 for "never reached the channel".
    expect(classifyFailure(0)).toBe("transient")
    expect(classifyFailure(422)).toBe("rejected")
    expect(classifyFailure(400)).toBe("rejected")
  })

  it("lets an explicit Retry-After outrank the status code", () => {
    // Some channels attach Retry-After to a 503 rather than a 429. The header is
    // the channel naming a time; the status is us inferring one.
    expect(classifyFailure(503, 30)).toBe("rate_limited")
  })

  it("still reads a 401 as auth even with a Retry-After", () => {
    // Waiting the requested interval and retrying a dead token is not a fix,
    // and doing it on a schedule is what gets an integration blocked.
    expect(classifyFailure(401, 30)).toBe("auth")
  })
})

describe("decideThrottle", () => {
  it("obeys Retry-After exactly", () => {
    const d = decideThrottle({
      current: fresh(),
      status: 429,
      retryAfterSeconds: 90,
      policy,
      now,
    })
    expect(d.throttled_until).toEqual(new Date("2026-08-04T12:01:30.000Z"))
  })

  it("never shortens a Retry-After to fit our own ceiling", () => {
    // The load-bearing case. A channel asking for eight hours means eight
    // hours; coming back after our one-hour cap because the cap was lower is
    // exactly what turns a throttle into a suspension. Our ceiling governs the
    // delays we invent, not the ones we were handed.
    const d = decideThrottle({
      current: fresh(),
      status: 429,
      retryAfterSeconds: 8 * 60 * 60,
      policy,
      now,
    })
    expect(d.throttled_until!.getTime() - now.getTime()).toBe(
      8 * 60 * 60 * 1000
    )
    expect(d.throttled_until!.getTime() - now.getTime()).toBeGreaterThan(
      policy.max_backoff_ms
    )
  })

  it("backs off exponentially on consecutive transient failures", () => {
    const first = decideThrottle({ current: fresh(), status: 503, policy, now })
    const second = decideThrottle({ current: first, status: 503, policy, now })
    const third = decideThrottle({ current: second, status: 503, policy, now })

    expect(first.throttled_until!.getTime() - now.getTime()).toBe(60_000)
    expect(second.throttled_until!.getTime() - now.getTime()).toBe(120_000)
    expect(third.throttled_until!.getTime() - now.getTime()).toBe(240_000)
    expect(third.consecutive_failures).toBe(3)
  })

  it("can back off for longer than the job interval", () => {
    // The reason any of this is stored rather than held in memory. The order
    // sync runs every 15 minutes, so a backoff shorter than that never binds —
    // the schedule was already longer. By the fifth failure it does.
    let state: ThrottleState = fresh()
    for (let i = 0; i < 5; i++) {
      state = decideThrottle({ current: state, status: 503, policy, now })
    }
    const waited = state.throttled_until!.getTime() - now.getTime()
    expect(waited).toBeGreaterThan(15 * 60 * 1000)
  })

  it("caps the delays it invents", () => {
    let state: ThrottleState = fresh()
    for (let i = 0; i < 30; i++) {
      state = decideThrottle({ current: state, status: 503, policy, now })
    }
    expect(state.throttled_until!.getTime() - now.getTime()).toBeLessThanOrEqual(
      policy.max_backoff_ms
    )
  })

  it("only ever jitters upward", () => {
    // Spreading retries stops every connection to a recovered channel from
    // firing in the same instant. Jittering *down* would undercut a ceiling
    // chosen deliberately, so the spread is one-sided.
    const plain = decideThrottle({ current: fresh(), status: 503, policy, now })
    const jittered = decideThrottle({
      current: fresh(),
      status: 503,
      policy,
      now,
      jitter: 0.9,
    })
    expect(jittered.throttled_until!.getTime()).toBeGreaterThan(
      plain.throttled_until!.getTime()
    )
  })

  it("stands down long and flags a human on dead credentials", () => {
    const d = decideThrottle({ current: fresh(), status: 401, policy, now })
    expect(d.needs_reauth).toBe(true)
    expect(d.throttled_until!.getTime() - now.getTime()).toBe(
      policy.auth_backoff_ms
    )
    expect(d.reason).toMatch(/Reconnect/i)
  })

  it("does not grow the auth wait with repeated failures", () => {
    // Waiting for a person, not for the channel. Doubling toward a week would
    // mean a vendor who pastes a new token still sits idle — which is why
    // `upsertConnection` clears the stand-down rather than waiting it out.
    const first = decideThrottle({ current: fresh(), status: 401, policy, now })
    const second = decideThrottle({ current: first, status: 401, policy, now })
    expect(second.throttled_until).toEqual(first.throttled_until)
  })

  it("does not pause the connection for one rejected request", () => {
    // A 422 is one malformed product, not a channel saying stop. Pausing the
    // whole connection would also stop order ingestion — and the vendor would
    // find out by overselling.
    const d = decideThrottle({ current: fresh(), status: 422, policy, now })
    expect(d.throttled_until).toBeNull()
    expect(d.needs_reauth).toBe(false)
  })

  it("does not advance the backoff exponent on a rejection", () => {
    // `consecutive_failures` is the exponent, not a tally of everything that
    // went wrong. One run over a catalogue with twenty malformed products would
    // otherwise advance it twenty steps, and the next ordinary blip would stand
    // the connection down for hours — a mapping bug quietly turned into an
    // outage.
    let state: ThrottleState = fresh()
    for (let i = 0; i < 20; i++) {
      state = decideThrottle({ current: state, status: 422, policy, now })
    }
    expect(state.consecutive_failures).toBe(0)

    const blip = decideThrottle({ current: state, status: 503, policy, now })
    expect(blip.throttled_until!.getTime() - now.getTime()).toBe(
      policy.base_backoff_ms
    )
  })

  it("keeps an existing stand-down when a rejection lands during one", () => {
    const throttled = decideThrottle({
      current: fresh(),
      status: 429,
      retryAfterSeconds: 600,
      policy,
      now,
    })
    const then = decideThrottle({
      current: throttled,
      status: 422,
      policy,
      now,
    })
    expect(then.throttled_until).toEqual(throttled.throttled_until)
  })

  it("resets on success, so one bad afternoon does not compound", () => {
    let state: ThrottleState = fresh()
    for (let i = 0; i < 4; i++) {
      state = decideThrottle({ current: state, status: 503, policy, now })
    }
    expect(clearedThrottle()).toEqual({
      throttled_until: null,
      consecutive_failures: 0,
      needs_reauth: false,
    })
  })
})

describe("shouldAttemptNow", () => {
  it("lets an unthrottled connection through", () => {
    expect(shouldAttemptNow({ throttled_until: null }, now)).toBe(true)
  })

  it("holds a connection whose stand-down has not expired", () => {
    const until = new Date(now.getTime() + 60_000)
    expect(shouldAttemptNow({ throttled_until: until }, now)).toBe(false)
  })

  it("releases it the instant the deadline passes, with no rewrite", () => {
    // Nothing clears `throttled_until` on a timer, so expiry has to be a
    // comparison rather than a state change — otherwise a connection stays
    // paused until something happens to touch the row.
    const until = new Date(now.getTime() - 1)
    expect(shouldAttemptNow({ throttled_until: until }, now)).toBe(true)
    expect(shouldAttemptNow({ throttled_until: now }, now)).toBe(true)
  })
})

describe("request spacing", () => {
  it("turns a per-minute ceiling into a gap between requests", () => {
    expect(minRequestSpacingMs({ ...policy, requests_per_minute: 60 })).toBe(
      1_000
    )
    expect(minRequestSpacingMs({ ...policy, requests_per_minute: 120 })).toBe(
      500
    )
  })

  it("never divides by zero on a nonsense policy", () => {
    expect(
      minRequestSpacingMs({ ...policy, requests_per_minute: 0 })
    ).toBe(60_000)
  })

  it("reports when the next request is allowed", () => {
    const last = new Date(now.getTime() - 200)
    expect(nextRequestAt(last, { ...policy, requests_per_minute: 60 }, now)).toEqual(
      new Date(last.getTime() + 1_000)
    )
    expect(nextRequestAt(null, policy, now)).toBeNull()
    const old = new Date(now.getTime() - 5_000)
    expect(nextRequestAt(old, policy, now)).toBeNull()
  })
})

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("120", now)).toBe(120)
  })

  it("reads the HTTP-date form too", () => {
    // Both forms are legal and channels use both. Handling only the first reads
    // as "no Retry-After sent" and silently substitutes our own guess for a
    // time the channel actually named.
    expect(parseRetryAfter("Tue, 04 Aug 2026 12:05:00 GMT", now)).toBe(300)
  })

  it("is null for absent or unparseable, never zero", () => {
    // Null falls back to exponential backoff. Zero would read as "retry now",
    // which against a channel that just refused us is a loop.
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter("", now)).toBeNull()
    expect(parseRetryAfter("   ", now)).toBeNull()
    expect(parseRetryAfter("soon", now)).toBeNull()
  })

  it("clamps a date already in the past to zero", () => {
    expect(parseRetryAfter("Tue, 04 Aug 2026 11:00:00 GMT", now)).toBe(0)
  })
})

describe("the policy table", () => {
  it("falls back to the conservative default for an unknown channel", () => {
    expect(ratePolicyFor("a-channel-that-does-not-exist")).toBe(
      DEFAULT_RATE_POLICY
    )
  })

  it("uses the declared policy for a channel that has one", () => {
    expect(ratePolicyFor("faire")).toBe(CHANNEL_RATE_POLICIES.faire)
  })

  it("declares nothing unbounded", () => {
    // A missing cap is not a generous limit, it is a backoff that doubles into
    // next week and turns a visible stall into a silent one.
    const policies = [
      DEFAULT_RATE_POLICY,
      ...Object.values(CHANNEL_RATE_POLICIES),
    ].filter(Boolean) as ChannelRatePolicy[]

    for (const p of policies) {
      expect(p.requests_per_minute).toBeGreaterThan(0)
      expect(p.base_backoff_ms).toBeGreaterThan(0)
      expect(p.max_backoff_ms).toBeGreaterThanOrEqual(p.base_backoff_ms)
      expect(Number.isFinite(p.max_backoff_ms)).toBe(true)
      expect(Number.isFinite(p.auth_backoff_ms)).toBe(true)
    }
  })

  it("backs off for longer than the fastest sync job's interval", () => {
    // channel-fulfillment-sync runs every 10 minutes. A ceiling below that
    // would make the whole mechanism decorative — the schedule would still be
    // the real throttle.
    const policies = [
      DEFAULT_RATE_POLICY,
      ...Object.values(CHANNEL_RATE_POLICIES),
    ].filter(Boolean) as ChannelRatePolicy[]

    for (const p of policies) {
      expect(p.max_backoff_ms).toBeGreaterThan(10 * 60 * 1000)
    }
  })
})
