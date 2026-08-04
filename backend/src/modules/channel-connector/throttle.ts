import type { ChannelId } from "./catalog"

/**
 * How hard FBM is allowed to hit a channel, and what to do when it says stop.
 *
 * Phase 12. The roadmap's framing is that per-channel throttling is analogous
 * to the embed rate limiters, and it is — except in direction. `shared/rate-
 * limiter.ts` protects *us* from callers. This protects *them* from us, and the
 * consequence of getting it wrong is not a slow endpoint but a suspended
 * seller account, which no amount of retrying repairs.
 *
 * What exists today is worth stating plainly, because it is the thing this
 * replaces: **the cron schedule is the throttle.** `channel-order-sync` runs
 * every 15 minutes and `channel-fulfillment-sync` every 10, and between those
 * ticks nothing limits anything. Two consequences follow.
 *
 * 1. **Within a run there is no ceiling at all.** `pushInventory` loops one
 *    request per SKU with no spacing, so a vendor with 500 SKUs emits 500
 *    requests as fast as the event loop allows. Faire tolerates it; Amazon and
 *    Etsy do not, and the roadmap names both as strict.
 * 2. **A backoff shorter than the schedule does nothing.** If a 429 sets a
 *    5-minute retry and the job runs every 15, the backoff never binds — the
 *    schedule was already longer. So a backoff is only real if it is *durable*
 *    (`throttled_until` on the connection row, checked at the top of every run)
 *    and allowed to exceed the interval. That is the single load-bearing idea
 *    in this file.
 *
 * Pure — no container, no clock, no I/O. `now` and `jitter` are arguments for
 * the same reason `overage.ts` and `gates.ts` take theirs: a rate policy is an
 * agreement with a third party, and an agreement should be assertable without
 * standing up a database or waiting real seconds to watch it expire.
 */

export type ChannelRatePolicy = {
  /**
   * Sustained ceiling. Converted to a minimum spacing between requests rather
   * than a bucket that can be drained all at once: a burst of 60 followed by 59
   * seconds of silence averages out to the same rate and still trips a
   * channel's per-second guard.
   */
  requests_per_minute: number
  /** First backoff step. Doubles per consecutive failure. */
  base_backoff_ms: number
  /**
   * Ceiling on backoff. Not unbounded: a connection that has been failing for
   * a day is a connection somebody must look at, and doubling into next week
   * turns a visible stall into a silent one.
   */
  max_backoff_ms: number
  /**
   * How long to stand down when the channel rejects the credentials.
   *
   * Deliberately long, and deliberately not exponential. A 401 does not heal on
   * its own — it needs a human to paste a new token — and retrying dead
   * credentials against a marketplace is itself the behaviour that gets an
   * integration blocked. The wait is for the human, not for the channel.
   */
  auth_backoff_ms: number
}

/** Applied to any channel without an entry. Conservative on purpose. */
export const DEFAULT_RATE_POLICY: ChannelRatePolicy = {
  requests_per_minute: 60,
  base_backoff_ms: 60_000,
  max_backoff_ms: 6 * 60 * 60 * 1000,
  auth_backoff_ms: 12 * 60 * 60 * 1000,
}

/**
 * Per-channel ceilings.
 *
 * Faire publishes no hard public number, so 120/min is a self-imposed limit
 * chosen to be well under any plausible one rather than discovered by being
 * throttled. When a channel *does* document a limit, this table is where it
 * goes — and an entry that merely repeats the default should still be written
 * out, because "we checked and it is the default" and "nobody has looked" are
 * different states and only one of them is safe to change.
 */
export const CHANNEL_RATE_POLICIES: Partial<Record<ChannelId, ChannelRatePolicy>> =
  {
    faire: {
      requests_per_minute: 120,
      base_backoff_ms: 60_000,
      max_backoff_ms: 6 * 60 * 60 * 1000,
      auth_backoff_ms: 12 * 60 * 60 * 1000,
    },
  }

export function ratePolicyFor(channelId: string): ChannelRatePolicy {
  return (
    CHANNEL_RATE_POLICIES[channelId as ChannelId] ?? DEFAULT_RATE_POLICY
  )
}

/** Minimum gap between two requests to the same channel, in milliseconds. */
export function minRequestSpacingMs(policy: ChannelRatePolicy): number {
  const rpm = Math.max(1, Math.floor(policy.requests_per_minute))
  return Math.ceil(60_000 / rpm)
}

/**
 * When the next request may be sent.
 *
 * `null` for "now". Returning a timestamp rather than sleeping keeps this
 * testable and lets the caller decide whether to wait or to defer the work to
 * the next run — a job with 500 SKUs and a 500ms spacing should pace, a job
 * facing a six-hour backoff should not sit in a timer for six hours.
 */
export function nextRequestAt(
  lastRequestAt: Date | null,
  policy: ChannelRatePolicy,
  now: Date
): Date | null {
  if (!lastRequestAt) return null
  const earliest = lastRequestAt.getTime() + minRequestSpacingMs(policy)
  return earliest > now.getTime() ? new Date(earliest) : null
}

/** What kind of "no" the channel said. Drives entirely different responses. */
export type ChannelFailureKind =
  /** 429, or an explicit Retry-After. The channel asked us to slow down. */
  | "rate_limited"
  /** 401/403. The credentials are dead; only a human fixes this. */
  | "auth"
  /** 5xx or a transport failure. Their fault or the network's; retry. */
  | "transient"
  /** Any other 4xx. Our request was wrong, and will be wrong again. */
  | "rejected"

export function classifyFailure(
  status: number,
  retryAfterSeconds?: number | null
): ChannelFailureKind {
  // An explicit Retry-After outranks the status code. Some channels attach one
  // to a 503 rather than a 429, and the header is the more specific statement
  // of intent — it is the channel naming a time, not us inferring one.
  if (retryAfterSeconds !== null && retryAfterSeconds !== undefined) {
    if (status === 401 || status === 403) return "auth"
    return "rate_limited"
  }
  if (status === 429) return "rate_limited"
  if (status === 401 || status === 403) return "auth"
  // Status 0 is `ChannelApiError`'s "never reached the channel".
  if (status === 0 || status >= 500) return "transient"
  return "rejected"
}

export type ThrottleState = {
  /** Nothing may be sent to this connection before this instant. */
  throttled_until: Date | null
  consecutive_failures: number
  /** True when the stall needs a human to re-enter credentials. */
  needs_reauth: boolean
}

export type ThrottleDecision = ThrottleState & {
  kind: ChannelFailureKind
  /** Why, in words a vendor can read. Stored on the row and shown in-panel. */
  reason: string
}

/**
 * How long to stand down after a failed call.
 *
 * Deliberate choices, each of which has a failure mode attached:
 *
 * - **An explicit `Retry-After` is obeyed exactly, and is never shortened.**
 *   Not clamped to `max_backoff_ms` either: a channel that asks for eight hours
 *   means eight hours, and coming back early because our own ceiling was lower
 *   is precisely the behaviour that escalates a throttle into a ban. Our
 *   ceiling governs the delays *we* invent, not the ones we were handed.
 * - **A rejection (`422`, `400`) does not throttle the connection.** It is one
 *   malformed request, not a channel saying stop; pausing the whole connection
 *   would also stop the operations that still work — an unlistable product
 *   would silently halt order ingestion, and the vendor would find out by
 *   overselling. It is counted so a connection failing every request is still
 *   visible.
 * - **Backoff grows on consecutive failures and resets on success**, so a
 *   single blip does not compound, and a persistent outage stops hammering.
 *
 * `jitter` is a caller-supplied value in [0, 1). Callers pass `Math.random()`;
 * tests pass a fixed number. Without it every connection to a channel that just
 * came back up retries in the same instant — the retry storm that keeps an
 * already-struggling API down, and the reason this is a parameter rather than
 * an internal call to a random source that could not be asserted on.
 */
export function decideThrottle(input: {
  current: ThrottleState
  status: number
  retryAfterSeconds?: number | null
  message?: string
  policy: ChannelRatePolicy
  now: Date
  jitter?: number
}): ThrottleDecision {
  const { current, status, policy, now } = input
  const kind = classifyFailure(status, input.retryAfterSeconds)
  const failures = current.consecutive_failures + 1
  const jitter = Math.min(0.999, Math.max(0, input.jitter ?? 0))

  if (kind === "rejected") {
    // Nothing moves. `consecutive_failures` is the *backoff exponent*, not a
    // tally of everything that went wrong, and a rejection is explicitly not a
    // reason to back off. Counting it would let one run over a catalogue with
    // twenty malformed products advance the exponent twenty steps, so the next
    // ordinary blip would stand the connection down for hours — a mapping bug
    // silently converted into an outage.
    return {
      throttled_until: current.throttled_until,
      consecutive_failures: current.consecutive_failures,
      needs_reauth: current.needs_reauth,
      kind,
      reason:
        input.message ??
        `The channel rejected the request (${status}). Retrying will not change it.`,
    }
  }

  if (kind === "auth") {
    return {
      throttled_until: new Date(now.getTime() + policy.auth_backoff_ms),
      consecutive_failures: failures,
      needs_reauth: true,
      kind,
      reason:
        "The channel rejected these credentials. Reconnect the channel with a new access token to resume syncing.",
    }
  }

  if (
    kind === "rate_limited" &&
    input.retryAfterSeconds !== null &&
    input.retryAfterSeconds !== undefined &&
    input.retryAfterSeconds > 0
  ) {
    const until = new Date(now.getTime() + input.retryAfterSeconds * 1000)
    return {
      throttled_until: until,
      consecutive_failures: failures,
      needs_reauth: false,
      kind,
      reason: `The channel asked us to wait ${Math.round(
        input.retryAfterSeconds
      )}s before retrying.`,
    }
  }

  // Exponential from the base, doubling per consecutive failure, capped — then
  // jittered upward only. Jittering downward could undercut a ceiling we chose
  // deliberately, so the spread is [delay, delay * 1.25).
  const doubled = policy.base_backoff_ms * Math.pow(2, failures - 1)
  const capped = Math.min(doubled, policy.max_backoff_ms)
  const delay = Math.round(capped * (1 + jitter * 0.25))

  return {
    throttled_until: new Date(now.getTime() + delay),
    consecutive_failures: failures,
    needs_reauth: false,
    kind,
    reason:
      kind === "rate_limited"
        ? `The channel rate-limited us. Backing off for ${Math.round(
            delay / 1000
          )}s.`
        : input.message ??
          `The channel could not be reached (${status}). Retrying in ${Math.round(
            delay / 1000
          )}s.`,
  }
}

/** State after a call that worked. The reset half of the loop. */
export function clearedThrottle(): ThrottleState {
  return { throttled_until: null, consecutive_failures: 0, needs_reauth: false }
}

/**
 * Whether a job may touch this connection right now.
 *
 * The check that makes a backoff outlast a job run. Without it `throttled_until`
 * is a column nobody reads and the cron schedule is still the only limit — so
 * every sync job calls this before its first request, not after.
 */
export function shouldAttemptNow(
  state: Pick<ThrottleState, "throttled_until">,
  now: Date
): boolean {
  if (!state.throttled_until) return true
  return state.throttled_until.getTime() <= now.getTime()
}

/**
 * Parse a `Retry-After` header.
 *
 * The header comes in two forms and channels use both: delta-seconds, and an
 * HTTP date. Handling only the first silently ignores the second, which reads
 * as "no Retry-After given" and drops us onto our own invented backoff — quietly
 * disregarding a time the channel actually named.
 *
 * Returns `null` for absent or unparseable, so the caller falls back to
 * exponential rather than to zero. A negative or past date is clamped to 0,
 * which the decision layer treats as "no wait requested" rather than as a
 * licence to retry immediately in a loop.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: Date
): number | null {
  if (!header) return null
  const raw = header.trim()
  if (!raw) return null

  if (/^\d+$/.test(raw)) {
    return Math.max(0, parseInt(raw, 10))
  }

  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.round((at - now.getTime()) / 1000))
}
