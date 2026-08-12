import ReviewsService from "../service"

/**
 * `getSellerAggregates` is the batched form of `getSellerAggregate`, added so
 * list endpoints could stop reading `seller_metadata.review_count` — a column
 * nothing writes, which made every creator in the marketplace listing show
 * "0 reviews" (C3). A per-row `getSellerAggregate` would have fixed the numbers
 * at the cost of one query per row.
 *
 * The service is built off the prototype with `listProductReviews` stubbed:
 * the aggregation logic is what's under test, not Medusa's data layer.
 */

type Row = { seller_id: string; rating: number }

const serviceWith = (rows: Row[]) => {
  const svc = Object.create(ReviewsService.prototype) as ReviewsService
  const listProductReviews = jest.fn(async () => rows)
  ;(svc as unknown as Record<string, unknown>).listProductReviews =
    listProductReviews
  return { svc, listProductReviews }
}

describe("ReviewsService.getSellerAggregates", () => {
  it("averages and counts per seller in a single query", async () => {
    const { svc, listProductReviews } = serviceWith([
      { seller_id: "sel_a", rating: 5 },
      { seller_id: "sel_a", rating: 4 },
      { seller_id: "sel_b", rating: 3 },
    ])

    const result = await svc.getSellerAggregates(["sel_a", "sel_b"])

    expect(listProductReviews).toHaveBeenCalledTimes(1)
    expect(result.get("sel_a")).toEqual({ average: 4.5, count: 2 })
    expect(result.get("sel_b")).toEqual({ average: 3, count: 1 })
  })

  it("reports sellers with no published reviews rather than omitting them", async () => {
    // Callers render a row per seller; a missing key would force them to
    // distinguish "no reviews" from "not looked up".
    const { svc } = serviceWith([{ seller_id: "sel_a", rating: 5 }])

    const result = await svc.getSellerAggregates(["sel_a", "sel_quiet"])

    expect(result.get("sel_quiet")).toEqual({ average: null, count: 0 })
  })

  it("rounds the average to one decimal place, matching getSellerAggregate", async () => {
    const { svc } = serviceWith([
      { seller_id: "sel_a", rating: 5 },
      { seller_id: "sel_a", rating: 4 },
      { seller_id: "sel_a", rating: 4 },
    ])

    // 13/3 = 4.333...
    expect((await svc.getSellerAggregates(["sel_a"])).get("sel_a")).toEqual({
      average: 4.3,
      count: 3,
    })
  })

  it("dedupes the requested ids", async () => {
    const { svc } = serviceWith([{ seller_id: "sel_a", rating: 5 }])

    const result = await svc.getSellerAggregates(["sel_a", "sel_a"])

    expect(result.size).toBe(1)
    expect(result.get("sel_a")).toEqual({ average: 5, count: 1 })
  })

  it("skips the query entirely for an empty request", async () => {
    const { svc, listProductReviews } = serviceWith([])

    const result = await svc.getSellerAggregates([])

    expect(listProductReviews).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it("ignores empty ids rather than querying for them", async () => {
    const { svc, listProductReviews } = serviceWith([])

    const result = await svc.getSellerAggregates(["", undefined as never])

    expect(listProductReviews).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })
})
