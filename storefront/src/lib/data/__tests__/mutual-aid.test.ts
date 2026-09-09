import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch, getAuthHeaders } = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  getAuthHeaders: vi.fn(),
}))

vi.mock("@/lib/config", () => ({ medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders }))

import {
  createAidOffer,
  createAidRequest,
  listAidOffers,
  listAidRequests,
  listMyAidOffers,
  listMyAidRequests,
  matchAidRequest,
  withdrawAidOffer,
  withdrawAidRequest,
} from "@/lib/data/mutual-aid"

/**
 * The storefront's client for `/store/mutual-aid/*`.
 *
 * Two properties matter more than the request shapes: the public reads must
 * never send credentials that would change what comes back, and the "your
 * posts" reads must degrade to an empty list rather than throwing — that
 * section sits on a public page a signed-out visitor should still be able to
 * read.
 */
beforeEach(() => {
  vi.clearAllMocks()
  getAuthHeaders.mockResolvedValue({ Authorization: "Bearer t" })
})

describe("public reads", () => {
  it("lists open requests without authenticating", async () => {
    medusaFetch.mockResolvedValue({ requests: [{ id: "mar_1" }] })

    expect(await listAidRequests()).toEqual([{ id: "mar_1" }])
    const [path, options] = medusaFetch.mock.calls[0]
    expect(path).toBe("/store/mutual-aid/requests")
    expect(options.method).toBe("GET")
    expect(options.headers).toBeUndefined()
  })

  it("passes a category filter through", async () => {
    medusaFetch.mockResolvedValue({ offers: [] })
    await listAidOffers({ category: "food" })

    expect(medusaFetch.mock.calls[0][1].query).toEqual({ category: "food" })
  })

  it("returns an empty array when the board key is missing", async () => {
    // A backend that 200s with an unexpected body should render an empty
    // board, not crash the page.
    medusaFetch.mockResolvedValue({})

    expect(await listAidRequests()).toEqual([])
    expect(await listAidOffers()).toEqual([])
  })

  it("never caches — a board people act on must not be stale", async () => {
    medusaFetch.mockResolvedValue({ requests: [] })
    await listAidRequests()

    expect(medusaFetch.mock.calls[0][1].cache).toBe("no-store")
  })
})

describe("your own posts", () => {
  it("returns an empty list when signed out rather than throwing", async () => {
    // This section is on a public page; a signed-out visitor sees the board.
    getAuthHeaders.mockResolvedValue(null)

    expect(await listMyAidRequests()).toEqual([])
    expect(await listMyAidOffers()).toEqual([])
    expect(medusaFetch).not.toHaveBeenCalled()
  })

  it("sends credentials and hits the mine routes when signed in", async () => {
    medusaFetch.mockResolvedValue({ requests: [{ id: "mar_1" }] })
    await listMyAidRequests()

    const [path, options] = medusaFetch.mock.calls[0]
    expect(path).toBe("/store/mutual-aid/requests/mine")
    expect(options.headers).toEqual({ Authorization: "Bearer t" })
  })
})

describe("posting", () => {
  it("never sends coordinates", async () => {
    // The API accepts latitude/longitude; this surface does not collect them.
    // Demanding a position from someone asking for help, to make matching
    // tidier, is the wrong trade.
    medusaFetch.mockResolvedValue({ request: { id: "mar_1" } })
    await createAidRequest({
      title: "A ride",
      description: "Tuesdays",
      locality: "Southwest Detroit",
      urgency: "SOON",
    })

    const body = medusaFetch.mock.calls[0][1].body
    expect(body).not.toHaveProperty("latitude")
    expect(body).not.toHaveProperty("longitude")
    expect(body).toMatchObject({ locality: "Southwest Detroit", urgency: "SOON" })
  })

  it("refuses to post while signed out, with a message a person can act on", async () => {
    getAuthHeaders.mockResolvedValue(null)

    await expect(
      createAidRequest({ title: "A ride", description: "Tuesdays" })
    ).rejects.toThrow(/signed in/i)
    await expect(
      createAidOffer({ title: "A freezer", description: "Spare" })
    ).rejects.toThrow(/signed in/i)
    expect(medusaFetch).not.toHaveBeenCalled()
  })
})

describe("withdraw and match", () => {
  it("posts to the withdraw route for the given id", async () => {
    medusaFetch.mockResolvedValue({ withdrawn: true, status: "WITHDRAWN" })
    await withdrawAidRequest("mar_1")

    expect(medusaFetch.mock.calls[0][0]).toBe(
      "/store/mutual-aid/requests/mar_1/withdraw"
    )
    expect(medusaFetch.mock.calls[0][1].method).toBe("POST")
  })

  it("withdraws an offer on its own route", async () => {
    medusaFetch.mockResolvedValue({ withdrawn: true, status: "WITHDRAWN" })
    await withdrawAidOffer("mao_1")

    expect(medusaFetch.mock.calls[0][0]).toBe(
      "/store/mutual-aid/offers/mao_1/withdraw"
    )
  })

  it("requires sign-in for every write", async () => {
    getAuthHeaders.mockResolvedValue(null)

    await expect(withdrawAidRequest("mar_1")).rejects.toThrow(/signed in/i)
    await expect(withdrawAidOffer("mao_1")).rejects.toThrow(/signed in/i)
    await expect(matchAidRequest("mar_1")).rejects.toThrow(/signed in/i)
    expect(medusaFetch).not.toHaveBeenCalled()
  })

  it("returns the next step the API hands back, without contact details", async () => {
    // The match endpoint deliberately returns no way to reach the other
    // person directly; it names where the conversation continues instead.
    medusaFetch.mockResolvedValue({
      matched: true,
      status: "MATCHED",
      next_step: "Message them in chat.",
    })

    const result = await matchAidRequest("mar_1")
    expect(result.next_step).toBe("Message them in chat.")
    expect(JSON.stringify(result)).not.toMatch(/email|phone|address/i)
  })
})
