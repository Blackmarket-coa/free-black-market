import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * What `fetchQuery` hands its callers from a refusal. It used to keep only
 * `message`, `type` and `code`, so the order id the main checkout's 409
 * `cart_already_completed` carries (backend SD-147) never reached
 * `placeOrder`, and the buyer could not be sent to their order (SD-147 open
 * item (j)).
 */

vi.hoisted(() => {
  // lib/config.ts reads both when it loads.
  process.env.MEDUSA_BACKEND_URL = "http://backend.test"
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_fetch_query_spec"
})

let fetchQuery: typeof import("@/lib/config").fetchQuery

beforeAll(async () => {
  fetchQuery = (await import("@/lib/config")).fetchQuery
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

describe("fetchQuery", () => {
  it("hands on the order a completed cart became, from the main checkout's 409", async () => {
    vi.stubGlobal(
      "fetch",
      answer(409, {
        code: "cart_already_completed",
        type: "cart_already_completed",
        message: "Your order for this cart has already been placed.",
        order_id: "order_01ABC",
      })
    )

    const res = await fetchQuery("/store/carts/cart_1/complete", { method: "POST" })

    expect(res.ok).toBe(false)
    expect(res.status).toBe(409)
    expect(res.data).toBeNull()
    expect(res.error).toMatchObject({ code: "cart_already_completed", orderId: "order_01ABC" })
  })

  it("names no order when the refusal carries none", async () => {
    vi.stubGlobal(
      "fetch",
      answer(409, { code: "cart_completion_incomplete", type: "cart_completion_incomplete", message: "Not placed." })
    )

    const res = await fetchQuery("/store/carts/cart_1/complete", { method: "POST" })

    expect(res.error?.orderId).toBeUndefined()
    expect(res.error?.message).toBe("Not placed.")
  })

  it("sends the publishable key, as every store call must", async () => {
    const fetch = answer(200, { ok: true })
    vi.stubGlobal("fetch", fetch)

    await fetchQuery("/store/carts/cart_1/complete", { method: "POST" })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://backend.test/store/carts/cart_1/complete")
    expect((init.headers as Record<string, string>)["x-publishable-api-key"]).toBe("pk_test_fetch_query_spec")
  })
})
