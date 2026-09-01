import { POST as publishRoute } from "../publish/route"
import { DELETE as deleteRoute } from "../route"
import { CreatorListingStatus } from "../../../../../../../../../modules/marketplace-listing/models/creator-listing"

/**
 * The commerce API authenticates with ONE shared `FREEBLACKMARKET_API_KEY`
 * held by the Blackout backend for every creator, so the key says nothing
 * about which seller is acting. Both routes previously resolved the listing by
 * id alone, which let any key holder publish, un-suspend or hard-delete any
 * seller's listing. These tests pin the owner assertion.
 *
 * `src/api/v1/integrations/**` is on the TS-3 enforcement ratchet, so this
 * file stays free of `any` — route arguments are narrowed with `as never`
 * rather than widened.
 */

jest.mock("../../../../../../../../../lib/blackout-commerce-auth", () => ({
  requireCommerceApiKey: jest.fn(() => true),
}))

jest.mock("../../../../../../../../../lib/blackout-identity", () => ({
  resolveSellerIdByBlackoutUserId: jest.fn(async (_scope: unknown, userId: string) =>
    userId === "bo_owner" ? "sel_owner" : userId === "bo_attacker" ? "sel_attacker" : null
  ),
}))

type Listing = Record<string, unknown>

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

function makeService(listings: Listing[]) {
  return {
    listings,
    listCreatorListings: jest.fn(async (filters: { id?: string }) =>
      listings.filter((l) => !filters.id || l.id === filters.id)
    ),
    updateCreatorListings: jest.fn(async (updates: Listing[]) =>
      updates.map((u) => {
        const row = listings.find((l) => l.id === u.id)
        if (row) Object.assign(row, u)
        return row ?? u
      })
    ),
    deleteCreatorListings: jest.fn(async (id: string) => {
      const i = listings.findIndex((l) => l.id === id)
      if (i >= 0) listings.splice(i, 1)
    }),
  }
}

const ownedListing = (): Listing => ({
  id: "clist_1",
  slug: "sparkle-sprite",
  seller_id: "sel_owner",
  status: CreatorListingStatus.DRAFT,
})

const makeReq = (
  service: ReturnType<typeof makeService>,
  opts: { body?: unknown; query?: unknown }
) => ({
  params: { id: "clist_1" },
  body: opts.body,
  query: opts.query ?? {},
  scope: { resolve: () => service },
})

describe("commerce publish route — owner assertion", () => {
  it("rejects a publish for a listing owned by another seller", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await publishRoute(
      makeReq(service, { body: { sellerUserId: "bo_attacker" } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe("forbidden")
    expect(service.updateCreatorListings).not.toHaveBeenCalled()
    expect(service.listings[0].status).toBe(CreatorListingStatus.DRAFT)
  })

  it("rejects a publish that names no seller at all", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await publishRoute(makeReq(service, { body: {} }) as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(service.updateCreatorListings).not.toHaveBeenCalled()
  })

  it("publishes the seller's own listing", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await publishRoute(
      makeReq(service, { body: { sellerUserId: "bo_owner" } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe(CreatorListingStatus.PUBLISHED)
  })

  it("refuses to publish a SUSPENDED listing, so publish cannot undo enforcement", async () => {
    const suspended: Listing = { ...ownedListing(), status: CreatorListingStatus.SUSPENDED }
    const service = makeService([suspended])
    const res = createRes()

    await publishRoute(
      makeReq(service, { body: { sellerUserId: "bo_owner" } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe("listing_suspended")
    expect(service.listings[0].status).toBe(CreatorListingStatus.SUSPENDED)
  })
})

describe("commerce delete route — owner assertion", () => {
  it("rejects a delete for a listing owned by another seller", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await deleteRoute(
      makeReq(service, { query: { sellerUserId: "bo_attacker" } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(403)
    expect(service.deleteCreatorListings).not.toHaveBeenCalled()
    expect(service.listings).toHaveLength(1)
  })

  it("rejects a delete that names no seller at all", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await deleteRoute(makeReq(service, {}) as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(service.listings).toHaveLength(1)
  })

  it("deletes the seller's own listing, reading the owner from the query string", async () => {
    const service = makeService([ownedListing()])
    const res = createRes()

    await deleteRoute(
      makeReq(service, { query: { sellerUserId: "bo_owner" } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(service.listings).toHaveLength(0)
  })
})
