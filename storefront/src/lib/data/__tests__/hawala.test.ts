import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `hawalaRequest` — the server action every `/store/hawala/*` call now goes
 * through. The point of it is the two headers the browser-side client never
 * sent: the publishable key (without it Medusa rejects every /store request)
 * and the signed-in customer's bearer (from the httpOnly `_medusa_jwt` cookie,
 * which browser code cannot read).
 *
 * `fetchQuery` from `lib/config` is the REAL one here — it is what attaches
 * the publishable key — so the env it reads at import is set first, and only
 * the network (`fetch`) and the cookie jar are stubbed.
 */
const { getAuthHeaders, flags } = vi.hoisted(() => {
  process.env.MEDUSA_BACKEND_URL = "https://api.test"
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_hawala"
  return { getAuthHeaders: vi.fn(), flags: { customerWallet: true } }
})

vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders }))
// The build-time flags, as a mutable stand-in: the wallet is ON for the
// transport tests and turned off in the describe that is about it. The real
// env reader is covered in lib/__tests__/customer-wallet-flag.test.ts.
vi.mock("@/lib/feature-flags", () => ({ phase1ModuleFlags: flags }))

import { hawalaRequest } from "@/lib/data/hawala"

const fetchMock = vi.fn()

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function sent() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string> }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => {})
  getAuthHeaders.mockResolvedValue({ Authorization: "Bearer jwt_customer" })
  flags.customerWallet = true
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete process.env.MEDUSA_BACKEND_URL
  delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
})

describe("hawalaRequest", () => {
  it("sends the publishable key and the customer's bearer on a wallet read", async () => {
    fetchMock.mockResolvedValue(respond(200, { wallet: { id: "acc_1" } }))

    const result = await hawalaRequest({ path: "/store/hawala/wallet" })

    expect(result).toEqual({ ok: true, data: { wallet: { id: "acc_1" } } })
    const { url, init, headers } = sent()
    expect(url).toBe("https://api.test/store/hawala/wallet")
    expect(init.method).toBe("GET")
    expect(headers["x-publishable-api-key"]).toBe("pk_test_hawala")
    expect(headers.Authorization).toBe("Bearer jwt_customer")
  })

  it("carries the body, the Idempotency-Key and both headers on a money movement", async () => {
    fetchMock.mockResolvedValue(respond(200, { transaction: { id: "tx_1" } }))

    await hawalaRequest({
      path: "/store/hawala/deposit",
      method: "POST",
      idempotencyKey: "idem-1",
      body: { bank_account_id: "ba_1", amount: 25 },
    })

    const { init, headers } = sent()
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ bank_account_id: "ba_1", amount: 25 })
    expect(headers["Idempotency-Key"]).toBe("idem-1")
    expect(headers["x-publishable-api-key"]).toBe("pk_test_hawala")
    expect(headers.Authorization).toBe("Bearer jwt_customer")
  })

  it("signed out, still sends the publishable key and no bearer (a guest contribution must work)", async () => {
    getAuthHeaders.mockResolvedValue(null)
    fetchMock.mockResolvedValue(respond(200, { pool_id: "pool_1" }))

    await hawalaRequest({ path: "/store/hawala/pools/pool_1/contributions", method: "POST", body: { amount_cents: 500 } })

    const { headers } = sent()
    expect(headers["x-publishable-api-key"]).toBe("pk_test_hawala")
    expect(headers).not.toHaveProperty("Authorization")
  })

  it("passes a query through", async () => {
    fetchMock.mockResolvedValue(respond(200, { transactions: [] }))
    await hawalaRequest({ path: "/store/hawala/transactions", query: { limit: 50 } })
    expect(sent().url).toMatch(/^https:\/\/api\.test\/store\/hawala\/transactions\?limit=50/)
  })

  it("refuses any path outside /store/hawala/ without calling the backend — it is not a bearer proxy", async () => {
    const paths = [
      "/store/customers/me",
      "/admin/users",
      "/store/hawala",
      "/store/hawala/",
      "/store/hawala//wallet",
      "/store/hawala/../customers/me",
      // fetch's URL parser decodes these to `..` and walks out of the prefix.
      "/store/hawala/%2e%2e/customers/me",
      "/store/hawala/%2E%2E/%2e%2e/auth/customer/emailpass/update",
      "/store/hawala/.%2e/customers/me",
      "/store/hawala/%2e./customers/me",
      "/store/hawala/./wallet",
      "/store/hawala/wallet%2f..%2f..%2fcustomers",
      "/store/hawala/wallet\\..\\..\\customers",
      "/store/hawala/wallet?x=1",
      "/store/hawala/wallet#x",
      "https://evil.test/store/hawala/wallet",
      "//evil.test/store/hawala/wallet",
    ]
    for (const path of paths) {
      const result = await hawalaRequest({ path })
      expect({ path, result }).toMatchObject({ path, result: { ok: false, status: 400, type: "invalid_request" } })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAuthHeaders).not.toHaveBeenCalled()
  })

  it("refuses any verb but GET and POST at runtime, whatever the TypeScript type says", async () => {
    for (const method of ["DELETE", "PUT", "PATCH", "get", "post", "OPTIONS", ""]) {
      const result = await hawalaRequest({ path: "/store/hawala/wallet", method } as unknown as Parameters<typeof hawalaRequest>[0])
      expect({ method, result }).toMatchObject({ method, result: { ok: false, status: 400, type: "invalid_request" } })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAuthHeaders).not.toHaveBeenCalled()
  })

  it("refuses a malformed query key or value, and an idempotency key that is not a token", async () => {
    const bad = [
      { query: { "limit&admin": 1 } },
      { query: { "a=b": "c" } },
      { query: { limit: { $gt: 1 } } },
      { query: ["limit"] },
      { idempotencyKey: "a\r\nX-Injected: 1" },
      { idempotencyKey: 42 },
    ]
    for (const extra of bad) {
      const result = await hawalaRequest({ path: "/store/hawala/transactions", ...extra } as unknown as Parameters<typeof hawalaRequest>[0])
      expect(result).toMatchObject({ ok: false, status: 400, type: "invalid_request" })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("URI-encodes query values, which fetchQuery would otherwise splice into the URL raw", async () => {
    fetchMock.mockResolvedValue(respond(200, { pools: [] }))
    await hawalaRequest({ path: "/store/hawala/pools", query: { producer_id: "p_1&admin=true#x" } })
    // fetchQuery leaves a trailing `&` after the last pair; that is its own quirk.
    expect(sent().url).toMatch(/^https:\/\/api\.test\/store\/hawala\/pools\?producer_id=p_1%26admin%3Dtrue%23x&?$/)
  })

  it("answers the server's status, type and message on a refusal", async () => {
    fetchMock.mockResolvedValue(respond(403, { type: "not_allowed", message: "You do not have access to this record." }))
    expect(await hawalaRequest({ path: "/store/hawala/pools/pool_1/contributions", method: "POST" })).toEqual({
      ok: false,
      status: 403,
      type: "not_allowed",
      message: "You do not have access to this record.",
    })
  })

  it("keeps a legacy `{ error }` message", async () => {
    fetchMock.mockResolvedValue(respond(400, { error: "Insufficient balance" }))
    expect(await hawalaRequest({ path: "/store/hawala/withdraw", method: "POST" })).toEqual({
      ok: false,
      status: 400,
      type: "request_failed",
      message: "Insufficient balance",
    })
  })

  it("turns a network failure into a result rather than a thrown (and, in production, masked) error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    expect(await hawalaRequest({ path: "/store/hawala/wallet" })).toMatchObject({ ok: false, status: 503, type: "network_error" })
  })
})

describe("hawalaRequest with NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 off", () => {
  const WALLET: [string, "GET" | "POST"][] = [
    ["/store/hawala/wallet", "GET"],
    ["/store/hawala/wallet", "POST"],
    ["/store/hawala/deposit", "POST"],
    ["/store/hawala/withdraw", "POST"],
    ["/store/hawala/transactions", "GET"],
    ["/store/hawala/bank-accounts", "GET"],
    ["/store/hawala/bank-accounts", "POST"],
    ["/store/hawala/bank-accounts/link", "POST"],
    ["/store/hawala/bank-accounts/ba_1", "GET"],
    // Express matches routes case-insensitively, so these reach the same handlers.
    ["/store/hawala/Wallet", "GET"],
    ["/store/hawala/WITHDRAW", "POST"],
    ["/store/hawala/Bank-Accounts/Link", "POST"],
  ]

  beforeEach(() => {
    flags.customerWallet = false
  })

  it.each(WALLET)("refuses %s %s without reading the cookie jar or calling the backend", async (path, method) => {
    const result = await hawalaRequest({ path, method })
    expect(result).toEqual({ ok: false, status: 400, type: "invalid_request", message: "Unsupported hawala request" })
    expect(getAuthHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["/store/hawala/pools", "GET"],
    ["/store/hawala/pools/pool_1/contributions", "POST"],
    ["/store/hawala/investments", "GET"],
    ["/store/hawala/investments", "POST"],
  ] as [string, "GET" | "POST"][])("still sends %s %s — pools, contributions and investments carry their own flags", async (path, method) => {
    fetchMock.mockResolvedValue(respond(200, { ok: 1 }))
    expect(await hawalaRequest({ path, method })).toEqual({ ok: true, data: { ok: 1 } })
    expect(sent().url).toBe(`https://api.test${path}`)
  })

  it("with the flag on the same wallet paths go out as before", async () => {
    flags.customerWallet = true
    for (const [path, method] of WALLET) {
      fetchMock.mockResolvedValueOnce(respond(200, {}))
      expect(await hawalaRequest({ path, method })).toEqual({ ok: true, data: {} })
    }
    expect(fetchMock).toHaveBeenCalledTimes(WALLET.length)
  })
})
