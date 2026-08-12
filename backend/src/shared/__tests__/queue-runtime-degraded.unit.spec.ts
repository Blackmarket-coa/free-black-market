/**
 * The degraded-idempotency path.
 *
 * `checkAndStoreIdempotency` falls back to a per-process Map when the shared
 * store is unreachable, and reports it as `degraded: true`. That fallback is a
 * real guard for one instance and no guard at all across a multi-instance
 * deploy. `runQueueConsumer` used to drop the flag on the floor, so the
 * exposure was invisible to operators and unobservable by callers.
 *
 * The store is mocked here rather than exercised through a real cache outage:
 * the point under test is that the runtime propagates the flag, not that the
 * store sets it (which `idempotency-store` owns). Mocking it also keeps this
 * file separate from `queue-runtime.unit.spec.ts`, whose cases depend on the
 * real store's behaviour.
 */

import { checkAndStoreIdempotency } from "../idempotency-store"
import { runQueueConsumer } from "../queue-runtime"

jest.mock("../idempotency-store", () => ({
  checkAndStoreIdempotency: jest.fn(),
}))

const mockedCheck = checkAndStoreIdempotency as jest.MockedFunction<
  typeof checkAndStoreIdempotency
>

const requeue = jest.fn(async () => undefined)
const publishToDlq = jest.fn(async () => undefined)

const payload = {
  event_id: "evt_degraded",
  occurred_at: "2026-08-12T00:00:00.000Z",
  product_id: "prod_1",
  variant_id: "var_1",
  delta: 1,
  reason: "test",
  channel: "storefront" as const,
}

const run = (handler: () => Promise<void> = async () => undefined, attempt = 0) =>
  runQueueConsumer({
    topicKey: "inventory_sync",
    payload,
    idempotencyKey: "idem_degraded",
    attempt,
    handler,
    publishToDlq,
    requeue,
  })

describe("runQueueConsumer — degraded idempotency", () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    requeue.mockClear()
    publishToDlq.mockClear()
    mockedCheck.mockReset()
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("reports degraded on a processed run", async () => {
    mockedCheck.mockResolvedValue({ duplicate: false, degraded: true } as never)

    const result = await run()

    expect(result.status).toBe("processed")
    expect(result.degraded).toBe(true)
  })

  it("warns so the exposure is alertable", async () => {
    mockedCheck.mockResolvedValue({ duplicate: false, degraded: true } as never)

    await run()

    expect(warnSpy).toHaveBeenCalled()
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("inventory_sync")
    expect(logged).toContain("cross-instance replay protection")
  })

  it("still processes the job rather than failing closed", async () => {
    // A cache outage must not become a queue outage.
    const handler = jest.fn(async () => undefined)
    mockedCheck.mockResolvedValue({ duplicate: false, degraded: true } as never)

    await run(handler)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("reports degraded on the duplicate path", async () => {
    mockedCheck.mockResolvedValue({
      duplicate: true,
      conflict: false,
      degraded: true,
    } as never)

    const result = await run()

    expect(result.status).toBe("duplicate")
    expect(result.degraded).toBe(true)
  })

  it("reports degraded on the conflict path", async () => {
    mockedCheck.mockResolvedValue({
      duplicate: true,
      conflict: true,
      degraded: true,
      message: "fingerprint mismatch",
    } as never)

    const result = await run()

    expect(result.status).toBe("idempotency_conflict")
    expect(result.degraded).toBe(true)
  })

  it("reports degraded on the retry path", async () => {
    mockedCheck.mockResolvedValue({ duplicate: false, degraded: true } as never)

    const result = await run(async () => {
      throw new Error("boom")
    })

    expect(result.status).toBe("retry")
    expect(result.degraded).toBe(true)
  })

  it("reports degraded on the dlq path", async () => {
    mockedCheck.mockResolvedValue({ duplicate: false, degraded: true } as never)

    const result = await run(async () => {
      throw new Error("permanent")
    }, 99)

    expect(result.status).toBe("dlq")
    expect(result.degraded).toBe(true)
  })

  it("reports degraded=false and stays quiet when the shared store is healthy", async () => {
    mockedCheck.mockResolvedValue({ duplicate: false } as never)

    const result = await run()

    expect(result.status).toBe("processed")
    expect(result.degraded).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
