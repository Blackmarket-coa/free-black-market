import {
  minRequestSpacingMs,
  ratePolicyFor,
  type ChannelRatePolicy,
} from "../modules/channel-connector/throttle"

/**
 * Spacing between successive outbound requests to one channel.
 *
 * The in-run half of Phase 12. `throttle.ts` decides how long to stand down
 * *after* a channel says no; this stops us provoking it in the first place.
 *
 * The gap it closes is concrete. `FaireChannelAdapter.pushInventory` loops one
 * request per SKU with nothing between iterations, so a 500-SKU catalogue emits
 * 500 requests as fast as the event loop can dispatch them. Nothing else in the
 * path limits that — the cron schedule bounds how often a *run* starts, not how
 * fast a run goes. A vendor with a large catalogue is therefore the one most
 * likely to get their own account throttled, which is precisely backwards.
 *
 * **Process-local, and honest about it.** Like `shared/plan-entitlement-cache.ts`,
 * this is a `Map` in one process rather than anything in Redis. Two workers
 * running the same channel can each pace to the limit and jointly exceed it, so
 * the per-channel ceilings in `CHANNEL_RATE_POLICIES` are set well below any
 * published number to leave room for that. A distributed limiter is the right
 * answer at more workers and more channels; pretending this one is distributed
 * would be worse than the honest ceiling, because the number would look
 * authoritative and be wrong.
 *
 * Keyed by channel, not by connection: a channel's rate limit is usually
 * enforced per API client, so two vendors on the same channel share whatever
 * budget it grants us.
 */

const lastRequestAt = new Map<string, number>()

/**
 * Hard cap on entries.
 *
 * Bounded for the same reason the entitlement cache is: an unbounded map keyed
 * by anything an outside system influences is a slow leak. Channel ids come
 * from a code-level catalogue so this cannot realistically be reached — the cap
 * exists so that stays true if the key ever widens.
 */
const MAX_TRACKED = 512

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait, if needed, until another request to this channel is allowed.
 *
 * Resolves immediately when enough time has already passed. The reservation is
 * recorded *before* awaiting, so two concurrent callers queue behind each other
 * rather than both reading the same stale timestamp and firing together — the
 * check-then-act race that would make the limiter do nothing under exactly the
 * concurrency it exists to handle.
 */
export async function pace(
  channelId: string,
  policy: ChannelRatePolicy = ratePolicyFor(channelId),
  now: () => number = Date.now
): Promise<void> {
  const spacing = minRequestSpacingMs(policy)
  const current = now()
  const previous = lastRequestAt.get(channelId) ?? 0
  const earliest = previous + spacing

  if (lastRequestAt.size >= MAX_TRACKED && !lastRequestAt.has(channelId)) {
    const oldest = lastRequestAt.keys().next()
    if (!oldest.done) lastRequestAt.delete(oldest.value)
  }

  if (earliest <= current) {
    lastRequestAt.set(channelId, current)
    return
  }

  lastRequestAt.set(channelId, earliest)
  await sleep(earliest - current)
}

/** Drop all pacing state. For tests, and for a worker that has gone idle. */
export function resetPacing(): void {
  lastRequestAt.clear()
}
