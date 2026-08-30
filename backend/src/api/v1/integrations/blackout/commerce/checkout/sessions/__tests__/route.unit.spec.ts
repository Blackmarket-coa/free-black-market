import { POST } from "../route"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../modules/marketplace-listing"
import { CreatorListingStatus } from "../../../../../../../../modules/marketplace-listing/models"

jest.mock("../../../../../../../../shared/config", () => ({
  config: { JWT_SECRET: "jwt-secret-".padEnd(48, "x") },
}))

type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const API_KEY = "test-commerce-api-key-1234567890"

const publishedListing = {
  id: "clist_1",
  status: CreatorListingStatus.PUBLISHED,
  price_cents: 500,
  currency: "USD",
}

/**
 * In-memory stand-in for the generated BlackoutCheckoutSession CRUD, with
 * the partial-unique-index semantics the migration enforces.
 */
function makeListingService(listings: Array<Record<string, unknown>>) {
  const sessions: Array<Record<string, unknown>> = []
  let nextId = 1
  return {
    sessions,
    listCreatorListings: jest.fn(async (filters: { id?: string }) =>
      listings.filter((l) => !filters.id || l.id === filters.id)
    ),
    listBlackoutCheckoutSessions: jest.fn(
      async (filters: Record<string, unknown>) =>
        sessions.filter((s) =>
          Object.entries(filters).every(([k, v]) => s[k] === v)
        )
    ),
    createBlackoutCheckoutSessions: jest.fn(
      async (data: Record<string, unknown>) => {
        if (
          data.idempotency_key &&
          sessions.some(
            (s) =>
              s.blackout_user_id === data.blackout_user_id &&
              s.listing_id === data.listing_id &&
              s.idempotency_key === data.idempotency_key
          )
        ) {
          throw new Error(
            'duplicate key value violates unique constraint "UQ_blackout_checkout_session_idem"'
          )
        }
        const record = { id: `bcs_${nextId++}`, status: "pending", ...data }
        sessions.push(record)
        return record
      }
    ),
  }
}

function makeReq(args: {
  body?: Record<string, unknown>
  idempotencyKey?: string
  service: ReturnType<typeof makeListingService>
  authorized?: boolean
}) {
  return {
    headers: {
      host: "fbm.test",
      ...(args.authorized === false
        ? {}
        : { authorization: `Bearer ${API_KEY}` }),
      ...(args.idempotencyKey ? { "idempotency-key": args.idempotencyKey } : {}),
    },
    protocol: "https",
    query: {},
    body: args.body ?? {},
    scope: {
      resolve: (key: string) => {
        if (key === MARKETPLACE_LISTING_MODULE) return args.service
        throw new Error(`unresolvable: ${key}`)
      },
    },
  }
}

type RouteArgs = Parameters<typeof POST>
const invoke = (req: unknown, res: TestRes) =>
  POST(req as RouteArgs[0], res as unknown as RouteArgs[1])

describe("POST blackout commerce checkout sessions — stateful idempotency (W1b)", () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.FBM_BLACKOUT_INTEGRATION = "1"
    process.env.FREEBLACKMARKET_API_KEY = API_KEY
    delete process.env.FREEBLACKMARKET_BASE_URL
    delete process.env.BACKEND_URL
  })

  afterAll(() => {
    process.env = ORIG_ENV
  })

  const validBody = { userId: "blk_user_1", listingId: "clist_1" }

  it("rejects an unauthenticated call", async () => {
    const service = makeListingService([publishedListing])
    const res = createRes()
    await invoke(makeReq({ body: validBody, service, authorized: false }), res)
    expect(res.statusCode).toBe(401)
    expect(service.createBlackoutCheckoutSessions).not.toHaveBeenCalled()
  })

  it("404s an unknown listing and 409s an unpurchasable one", async () => {
    const service = makeListingService([
      publishedListing,
      { id: "clist_draft", status: CreatorListingStatus.DRAFT, price_cents: 500, currency: "USD" },
      { id: "clist_free", status: CreatorListingStatus.PUBLISHED, price_cents: 0, currency: "USD" },
    ])

    const notFound = createRes()
    await invoke(
      makeReq({ body: { ...validBody, listingId: "nope" }, service }),
      notFound
    )
    expect(notFound.statusCode).toBe(404)

    for (const listingId of ["clist_draft", "clist_free"]) {
      const res = createRes()
      await invoke(makeReq({ body: { ...validBody, listingId }, service }), res)
      expect(res.statusCode).toBe(409)
      expect((res.body as { code: string }).code).toBe("listing_not_purchasable")
    }
    expect(service.createBlackoutCheckoutSessions).not.toHaveBeenCalled()
  })

  it("creates one session and returns the SAME id on an idempotent retry", async () => {
    const service = makeListingService([publishedListing])

    const first = createRes()
    await invoke(
      makeReq({ body: validBody, idempotencyKey: "idem-1", service }),
      first
    )
    expect(first.statusCode).toBe(201)
    const firstBody = first.body as { id: string; url: string }
    expect(firstBody.id).toMatch(/^bcs_/)
    expect(firstBody.url).toContain(
      "/v1/integrations/blackout/commerce/checkout/sessions/"
    )
    expect(firstBody.url).toContain("/page")

    const retry = createRes()
    await invoke(
      makeReq({ body: validBody, idempotencyKey: "idem-1", service }),
      retry
    )
    expect(retry.statusCode).toBe(201)
    expect((retry.body as { id: string }).id).toBe(firstBody.id)
    expect(service.createBlackoutCheckoutSessions).toHaveBeenCalledTimes(1)
    expect(service.sessions).toHaveLength(1)
  })

  it("recovers the winner's session when the unique index rejects a race", async () => {
    const service = makeListingService([publishedListing])
    // Simulate the race: the row exists but the first lookup misses it.
    service.listBlackoutCheckoutSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "bcs_winner", status: "pending" },
      ])
    service.createBlackoutCheckoutSessions.mockRejectedValueOnce(
      new Error("duplicate key value violates unique constraint")
    )

    const res = createRes()
    await invoke(
      makeReq({ body: validBody, idempotencyKey: "idem-race", service }),
      res
    )
    expect(res.statusCode).toBe(201)
    expect((res.body as { id: string }).id).toBe("bcs_winner")
  })

  it("mints distinct sessions without an idempotency key", async () => {
    const service = makeListingService([publishedListing])
    const a = createRes()
    const b = createRes()
    await invoke(makeReq({ body: validBody, service }), a)
    await invoke(makeReq({ body: validBody, service }), b)
    expect((a.body as { id: string }).id).not.toBe((b.body as { id: string }).id)
    expect(service.sessions).toHaveLength(2)
  })

  it("bounds the metadata echo and merges sku into it", async () => {
    const service = makeListingService([publishedListing])
    const res = createRes()
    await invoke(
      makeReq({
        body: {
          ...validBody,
          sku: "tier-monthly",
          metadata: { creatorSubscriptionId: "csub_9" },
        },
        service,
      }),
      res
    )
    expect(res.statusCode).toBe(201)
    expect(service.sessions[0].requested_metadata).toEqual({
      creatorSubscriptionId: "csub_9",
      sku: "tier-monthly",
    })
  })

  it("rejects unknown body fields (strict schema)", async () => {
    const service = makeListingService([publishedListing])
    const res = createRes()
    await invoke(
      makeReq({ body: { ...validBody, surprise: true }, service }),
      res
    )
    expect(res.statusCode).toBe(400)
  })
})
