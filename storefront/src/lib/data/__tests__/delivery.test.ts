import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The delivery step's eligibility check, from the server.
 *
 * The browser used to POST `/store/delivery-zones/check` itself with a bare
 * `fetch` and no publishable key; the checkout scout measured the backend's
 * answer: 400 "Publishable API key required in the request header". These run
 * the real `medusaFetch` and the real Medusa SDK under it, with only the
 * network stubbed, so what is asserted is the request that leaves the
 * storefront's server.
 */

const h = vi.hoisted(() => {
  // lib/config.ts reads both when it loads.
  process.env.MEDUSA_BACKEND_URL = "http://backend.test"
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_delivery_spec"
  return { getAuthHeaders: vi.fn() }
})

vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders: h.getAuthHeaders }))

let checkDeliveryForPostalCode: typeof import("@/lib/data/delivery").checkDeliveryForPostalCode
let checkDeliveryAt: typeof import("@/lib/data/delivery").checkDeliveryAt

beforeAll(async () => {
  ;({ checkDeliveryForPostalCode, checkDeliveryAt } = await import("@/lib/data/delivery"))
})

type Sent = { url: URL; method: string; headers: Headers; body: unknown }
let sent: Sent[] = []

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The backend, by path: what each route answers. */
function backend(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
      sent.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), body })
      const route = routes[`${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`]
      return route ? route() : json(404, { message: "Not found" })
    })
  )
}

const AVAILABLE = {
  available: true,
  code: "DELIVERY_AVAILABLE",
  message: "Delivery available! Estimated 20-30 min",
  next_action: "continue_checkout",
}

beforeEach(() => {
  sent = []
  h.getAuthHeaders.mockReset()
  h.getAuthHeaders.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkDeliveryForPostalCode", () => {
  it("places the postal code and checks the point, each call with the publishable key", async () => {
    backend({
      "GET /store/geocode": () => json(200, { zip: "30301", latitude: 33.7, longitude: -84.4, approximate: true }),
      "POST /store/delivery-zones/check": () => json(200, AVAILABLE),
    })

    // The backend placed the postal code at its ZIP3 centroid: the answer
    // says so, for the step to say the check is approximate.
    await expect(checkDeliveryForPostalCode("30301")).resolves.toEqual({ ...AVAILABLE, approximate: true })

    expect(sent.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      "GET /store/geocode",
      "POST /store/delivery-zones/check",
    ])
    const [geocode, check] = sent
    expect(geocode.url.searchParams.get("postal_code")).toBe("30301")
    expect(check.url.origin).toBe("http://backend.test")
    expect(check.body).toEqual({ latitude: 33.7, longitude: -84.4 })
    for (const request of sent) {
      expect(request.headers.get("x-publishable-api-key")).toBe("pk_test_delivery_spec")
    }
    // A guest sends no token.
    expect(check.headers.get("authorization")).toBeNull()
  })

  it("sends a signed-in buyer's token with the check", async () => {
    h.getAuthHeaders.mockResolvedValue({ Authorization: "Bearer buyer_jwt" })
    backend({
      "GET /store/geocode": () => json(200, { latitude: 33.7, longitude: -84.4 }),
      "POST /store/delivery-zones/check": () => json(200, AVAILABLE),
    })

    // A point the backend placed exactly carries no "approximate".
    await expect(checkDeliveryForPostalCode("30301")).resolves.toEqual(AVAILABLE)

    expect(sent[1].headers.get("authorization")).toBe("Bearer buyer_jwt")
  })

  it("passes the backend's \"no\" on as it is", async () => {
    const outside = {
      available: false,
      code: "DELIVERY_NOT_AVAILABLE",
      reason: "Outside delivery area. We don't currently deliver to your location.",
      suggestion: "You may be able to order for pickup instead.",
      next_action: "switch_to_pickup",
    }
    backend({
      "GET /store/geocode": () => json(200, { latitude: 47.6, longitude: -122.3 }),
      "POST /store/delivery-zones/check": () => json(200, outside),
    })

    await expect(checkDeliveryForPostalCode("98101")).resolves.toEqual(outside)
  })

  // Until the backend unit lifts the login requirement, a guest's check is
  // refused 401 (measured): reported as a check that could not be made.
  it.each([
    [401, { message: "Unauthorized" }],
    [400, { message: "Publishable API key required in the request header: x-publishable-api-key." }],
    [500, { message: "An unknown error occurred." }],
  ])("answers a refused check (%i) as a check that could not be made, never as \"no\"", async (status, body) => {
    backend({
      "GET /store/geocode": () => json(200, { latitude: 33.7, longitude: -84.4 }),
      "POST /store/delivery-zones/check": () => json(status, body),
    })

    const answer = await checkDeliveryForPostalCode("30301")

    expect(answer.available).toBe(false)
    expect(answer.code).toBe("DELIVERY_CHECK_FAILED")
    expect(answer.reason).toMatch(/couldn't check delivery/)
  })

  it("answers a postal code the backend cannot place as such, without asking for a check", async () => {
    backend({ "GET /store/geocode": () => json(404, { message: "Unknown postal code" }) })

    const answer = await checkDeliveryForPostalCode("00000")

    expect(answer).toMatchObject({ available: false, code: "DELIVERY_COORDINATES_UNAVAILABLE" })
    expect(sent.map((s) => s.url.pathname)).toEqual(["/store/geocode"])
  })

  it("asks nothing for a postal code too short to place", async () => {
    backend({})

    await expect(checkDeliveryForPostalCode(" 3 ")).resolves.toMatchObject({
      code: "DELIVERY_COORDINATES_UNAVAILABLE",
    })
    expect(sent).toEqual([])
  })
})

describe("checkDeliveryAt", () => {
  it("checks a point with the publishable key and the producer, when there is one", async () => {
    backend({ "POST /store/delivery-zones/check": () => json(200, AVAILABLE) })

    await expect(checkDeliveryAt({ latitude: 33.75, longitude: -84.39, producer_id: "prod_1" })).resolves.toEqual(
      AVAILABLE
    )

    expect(sent[0].headers.get("x-publishable-api-key")).toBe("pk_test_delivery_spec")
    expect(sent[0].body).toEqual({ latitude: 33.75, longitude: -84.39, producer_id: "prod_1" })
  })
})
