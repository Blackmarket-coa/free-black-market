import { pace, resetPacing } from "../channel-pacer"
import type { ChannelRatePolicy } from "../../modules/channel-connector/throttle"

/**
 * The in-run half of Phase 12. Before it, `pushInventory` emitted one request
 * per SKU with nothing between iterations — a 500-SKU catalogue was a 500-request
 * burst, and the vendor with the largest catalogue was the one most likely to get
 * their own channel account throttled.
 */

const policy: ChannelRatePolicy = {
  requests_per_minute: 120, // 500ms apart
  base_backoff_ms: 1_000,
  max_backoff_ms: 10_000,
  auth_backoff_ms: 100_000,
}

beforeEach(() => resetPacing())

/** A clock the test drives, so no test waits real seconds. */
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe("pace", () => {
  it("does not delay the first request", async () => {
    const clock = fakeClock()
    const before = Date.now()
    await pace("faire", policy, clock.now)
    expect(Date.now() - before).toBeLessThan(50)
  })

  it("does not delay once the gap has already elapsed", async () => {
    const clock = fakeClock()
    await pace("faire", policy, clock.now)
    clock.advance(5_000)

    const before = Date.now()
    await pace("faire", policy, clock.now)
    expect(Date.now() - before).toBeLessThan(50)
  })

  it("waits out the remaining gap when a request comes too soon", async () => {
    const clock = fakeClock()
    await pace("faire", policy, clock.now)
    clock.advance(100) // 400ms still owed

    const before = Date.now()
    await pace("faire", policy, clock.now)
    const waited = Date.now() - before
    expect(waited).toBeGreaterThanOrEqual(350)
    expect(waited).toBeLessThan(900)
  })

  it("queues concurrent callers instead of letting them fire together", async () => {
    // The check-then-act race: without reserving the slot before awaiting, two
    // callers read the same timestamp, both decide they may go, and the limiter
    // does nothing under exactly the concurrency it exists to handle.
    const clock = fakeClock()
    await pace("faire", policy, clock.now)

    const before = Date.now()
    await Promise.all([
      pace("faire", policy, clock.now),
      pace("faire", policy, clock.now),
    ])
    // Two more slots at 500ms each, measured from the first request.
    expect(Date.now() - before).toBeGreaterThanOrEqual(900)
  })

  it("paces each channel independently", async () => {
    // A rate limit belongs to one channel's API. Making a Faire push wait on an
    // unrelated channel's traffic would be a throttle we invented.
    const clock = fakeClock()
    await pace("faire", policy, clock.now)

    const before = Date.now()
    await pace("another-channel", policy, clock.now)
    expect(Date.now() - before).toBeLessThan(50)
  })

  it("survives a nonsense policy without hanging", async () => {
    const clock = fakeClock()
    const before = Date.now()
    await pace("faire", { ...policy, requests_per_minute: 0 }, clock.now)
    // First request is never delayed regardless of spacing.
    expect(Date.now() - before).toBeLessThan(50)
  })
})
