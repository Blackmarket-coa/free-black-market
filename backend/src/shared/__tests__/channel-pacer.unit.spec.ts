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

beforeEach(() => {
  resetPacing()
  // The pacer sleeps with setTimeout; fake timers let each test say exactly
  // when a request is let through, instead of measuring wall-clock time — an
  // upper bound on real elapsed time fails on a loaded CI runner (a 400ms
  // wait measured 1309ms there) while proving nothing about the pacer.
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

/** A clock the test drives, so no test waits real seconds. */
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

/** Start a call and report whether it has been let through yet. */
function track(promise: Promise<void>) {
  const state = { done: false }
  void promise.then(() => {
    state.done = true
  })
  return state
}

describe("pace", () => {
  it("does not delay the first request", async () => {
    const clock = fakeClock()
    const call = track(pace("faire", policy, clock.now))
    await jest.advanceTimersByTimeAsync(0)
    expect(call.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("does not delay once the gap has already elapsed", async () => {
    const clock = fakeClock()
    await pace("faire", policy, clock.now)
    clock.advance(5_000)

    const call = track(pace("faire", policy, clock.now))
    await jest.advanceTimersByTimeAsync(0)
    expect(call.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("waits out exactly the remaining gap when a request comes too soon", async () => {
    const clock = fakeClock()
    await pace("faire", policy, clock.now)
    clock.advance(100) // 400ms still owed

    const call = track(pace("faire", policy, clock.now))
    await jest.advanceTimersByTimeAsync(399)
    expect(call.done).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    expect(call.done).toBe(true)
  })

  it("queues concurrent callers instead of letting them fire together", async () => {
    // The check-then-act race: without reserving the slot before awaiting, two
    // callers read the same timestamp, both decide they may go, and the limiter
    // does nothing under exactly the concurrency it exists to handle.
    const clock = fakeClock()
    await pace("faire", policy, clock.now)

    const a = track(pace("faire", policy, clock.now))
    const b = track(pace("faire", policy, clock.now))
    // Two more slots at 500ms each, measured from the first request.
    await jest.advanceTimersByTimeAsync(499)
    expect([a.done, b.done]).toEqual([false, false])
    await jest.advanceTimersByTimeAsync(1)
    expect([a.done, b.done]).toEqual([true, false])
    await jest.advanceTimersByTimeAsync(499)
    expect(b.done).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    expect(b.done).toBe(true)
  })

  it("paces each channel independently", async () => {
    // A rate limit belongs to one channel's API. Making a Faire push wait on an
    // unrelated channel's traffic would be a throttle we invented.
    const clock = fakeClock()
    await pace("faire", policy, clock.now)

    const call = track(pace("another-channel", policy, clock.now))
    await jest.advanceTimersByTimeAsync(0)
    expect(call.done).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("survives a nonsense policy without hanging", async () => {
    const clock = fakeClock()
    const call = track(pace("faire", { ...policy, requests_per_minute: 0 }, clock.now))
    await jest.advanceTimersByTimeAsync(0)
    // First request is never delayed regardless of spacing.
    expect(call.done).toBe(true)
  })
})
