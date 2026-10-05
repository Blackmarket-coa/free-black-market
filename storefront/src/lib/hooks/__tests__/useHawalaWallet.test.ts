import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The browser-side hawala client must not call the backend itself — that is
 * how every call went out with no publishable key and no customer. It hands
 * each request to the `hawalaRequest` server action (which attaches both; see
 * lib/data/__tests__/hawala.test.ts) and turns a refusal into a
 * HawalaRequestError.
 */
const { hawalaRequest } = vi.hoisted(() => ({ hawalaRequest: vi.fn() }))
vi.mock("@/lib/data/hawala", () => ({ hawalaRequest }))

import { contributeToCarriedPool, HawalaRequestError } from "@/lib/hooks/useHawalaWallet"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
})

describe("contributeToCarriedPool", () => {
  it("goes through the server action with the path, body and a fresh Idempotency-Key — never fetch() from the browser", async () => {
    hawalaRequest.mockResolvedValue({ ok: true, data: { pool_id: "pool_1", record_status: "PENDING" } })

    const result = await contributeToCarriedPool("pool_1", 25.004 * 100)

    expect(result).toEqual({ pool_id: "pool_1", record_status: "PENDING" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hawalaRequest).toHaveBeenCalledTimes(1)
    const [req] = hawalaRequest.mock.calls[0]
    expect(req).toMatchObject({
      path: "/store/hawala/pools/pool_1/contributions",
      method: "POST",
      body: { amount_cents: 2500, currency_code: "usd" },
    })
    expect(typeof req.idempotencyKey).toBe("string")
    expect(req.idempotencyKey.length).toBeGreaterThan(0)

    await contributeToCarriedPool("pool_1", 2500)
    expect(hawalaRequest.mock.calls[1][0].idempotencyKey).not.toBe(req.idempotencyKey)
  })

  it("throws a HawalaRequestError carrying the server's type, message and status", async () => {
    hawalaRequest.mockResolvedValue({ ok: false, status: 409, type: "pool_not_open", message: "Pool is not open" })

    const err = await contributeToCarriedPool("pool_1", 2500).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HawalaRequestError)
    expect(err).toMatchObject({ type: "pool_not_open", message: "Pool is not open", status: 409 })
  })
})
