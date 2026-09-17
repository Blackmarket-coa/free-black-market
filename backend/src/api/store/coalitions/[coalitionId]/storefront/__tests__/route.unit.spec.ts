import { GET } from "../route"

/**
 * The collective storefront: every member shop's catalog under one view.
 *
 * The load-bearing detail is which column resolves a member's shop.
 * `cooperative_member.producer_id` receives a customer actor id on the store
 * join path and a producer row id on the seller launch path, so it cannot
 * resolve a catalog at all; `seller_id` can. A regression there would silently
 * render an empty storefront for a coalition that has shops.
 */

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

const graph = jest.fn(async (..._args: unknown[]) => ({ data: [] as Record<string, unknown>[] }))

function makeReq(
  cooperatives: Record<string, unknown>[],
  members: Record<string, unknown>[],
  query: Record<string, string> = {}
) {
  return {
    params: { coalitionId: "coa_1" },
    query,
    scope: {
      resolve: (key: string) =>
        key === "cooperative"
          ? {
              listCooperatives: async () => cooperatives,
              listCooperativeMembers: async () => members,
            }
          : { graph },
    },
  } as never
}

const coop = [
  { id: "coop_1", name: "Westside", handle: "westside", is_active: true, public_storefront_enabled: true },
]

beforeEach(() => {
  graph.mockClear()
  graph.mockResolvedValue({ data: [] })
})

describe("GET /store/coalitions/:id/storefront", () => {
  it("queries member catalogs by seller_id, never producer_id", async () => {
    graph.mockResolvedValue({
      data: [
        {
          id: "prod_1",
          title: "Greens",
          handle: "greens",
          seller: { id: "sel_a", name: "A Farm", handle: "a-farm" },
          variants: [{ prices: [{ amount: 400, currency_code: "usd" }] }],
        },
      ],
    })
    const res = makeRes()
    await GET(
      makeReq(coop, [
        { seller_id: "sel_a", producer_id: "cus_wrong" },
        { seller_id: "sel_b", producer_id: "prod_wrong" },
      ]),
      res as never
    )

    const filters = (graph.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    expect(filters["seller.id"]).toEqual(["sel_a", "sel_b"])
    expect(filters.status).toBe("published")
    expect(res.body?.count).toBe(1)
    expect((res.body?.products as Record<string, unknown>[])[0].price).toBe(400)
  })

  it("renders an empty storefront for a coalition whose members have no shops", async () => {
    const res = makeRes()
    await GET(makeReq(coop, [{ seller_id: null, producer_id: "cus_1" }]), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body?.products).toEqual([])
    expect(graph).not.toHaveBeenCalled()
  })

  it("degrades to the member list when the catalog query fails", async () => {
    graph.mockRejectedValue(new Error("query down"))
    const res = makeRes()
    await GET(makeReq(coop, [{ seller_id: "sel_a" }]), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body?.products).toEqual([])
    expect(res.body?.cooperative).toMatchObject({ id: "coop_1" })
  })

  it("does not expose a storefront the coalition has kept private", async () => {
    const res = makeRes()
    await GET(
      makeReq([{ ...coop[0], public_storefront_enabled: false }], [{ seller_id: "sel_a" }]),
      res as never
    )
    expect(res.statusCode).toBe(404)
    expect(res.body?.code).toBe("storefront_disabled")
  })

  it("404s for a coalition with no cooperative behind it", async () => {
    const res = makeRes()
    await GET(makeReq([], []), res as never)
    expect(res.statusCode).toBe(404)
  })

  it("caps the page size a caller can ask for", async () => {
    const res = makeRes()
    await GET(makeReq(coop, [{ seller_id: "sel_a" }], { limit: "5000" }), res as never)
    expect((graph.mock.calls[0][0] as { pagination: { take: number } }).pagination.take).toBe(100)
    expect(res.statusCode).toBe(200)
  })
})
