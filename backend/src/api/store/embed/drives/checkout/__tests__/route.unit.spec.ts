import { POST } from "../route"

/**
 * The embedded drive donate button.
 *
 * Two defects this pins. The route used to build a URL at
 * `/v1/integrations/blackout/commerce/checkout/drive`, which is not a route —
 * only `checkout/sessions` exists — so every donate click was a 404. And it
 * re-read the listing's price and status but never checked the listing was the
 * one the named drive actually sells, so any embed key could point any
 * coalition's drive at any published listing and take money in that
 * coalition's name.
 */

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

const listCreatorListings = jest.fn(async (..._args: unknown[]) => [] as Record<string, unknown>[])

const makeReq = (body: Record<string, unknown>) =>
  ({
    embed_key_id: "ek_1",
    body,
    headers: {},
    scope: { resolve: () => ({ listCreatorListings }) },
  }) as never

const VALID = {
  coalition_id: "coa_1",
  drive_id: "camp_1",
  listing_id: "lst_1",
  amount_cents: 2_500,
}

const driveListing = {
  id: "lst_1",
  status: "published",
  price_cents: 500,
  metadata: { coalition_id: "coa_1", drive_id: "camp_1" },
}

let fetchMock: jest.Mock

beforeEach(() => {
  process.env.FREEBLACKMARKET_API_KEY = "test-key"
  listCreatorListings.mockResolvedValue([driveListing])
  fetchMock = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: "cs_1", url: "https://fbm.test/checkout/cs_1?embed=1" }),
  }))
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
})

describe("POST /store/embed/drives/checkout", () => {
  it("opens a real session on the checkout endpoint that exists", async () => {
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body?.checkout_url).toBe("https://fbm.test/checkout/cs_1?embed=1")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/v1/integrations/blackout/commerce/checkout/sessions")
    expect(url).not.toContain("/checkout/drive")
    // The server's own key, never the caller's embed key.
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key")
    const sent = JSON.parse(String(init.body)) as { listingId: string; metadata: Record<string, string> }
    expect(sent.listingId).toBe("lst_1")
    expect(sent.metadata.campaignId).toBe("camp_1")
  })

  it("refuses a listing that does not belong to the named drive", async () => {
    listCreatorListings.mockResolvedValue([
      { ...driveListing, metadata: { coalition_id: "coa_other", drive_id: "camp_other" } },
    ])
    const res = makeRes()
    await POST(makeReq(VALID), res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body?.code).toBe("listing_not_for_drive")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a listing carrying no drive attribution at all", async () => {
    listCreatorListings.mockResolvedValue([{ ...driveListing, metadata: {} }])
    const res = makeRes()
    await POST(makeReq(VALID), res as never)
    expect(res.statusCode).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("still requires an embed key", async () => {
    const res = makeRes()
    await POST({ body: VALID, headers: {}, scope: { resolve: () => ({ listCreatorListings }) } } as never, res as never)
    expect(res.statusCode).toBe(401)
  })

  it("says so plainly when the checkout is not configured", async () => {
    delete process.env.FREEBLACKMARKET_API_KEY
    const res = makeRes()
    await POST(makeReq(VALID), res as never)
    expect(res.statusCode).toBe(503)
    expect(res.body?.code).toBe("checkout_unavailable")
  })

  it("reports a refused session rather than returning a dead URL", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({}) })
    const res = makeRes()
    await POST(makeReq(VALID), res as never)
    expect(res.statusCode).toBe(502)
    expect(res.body?.code).toBe("checkout_failed")
  })
})
