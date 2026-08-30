/**
 * `POST/GET /store/reviews` after the W4 reviews dedupe.
 *
 * The POST accepts both dialects — FBM's `{order_id, product_id, …}` and the
 * storefront's `{order_id, reference, reference_id, customer_note}` (the
 * shape its ReviewForm has always sent, which used to 400 against this
 * handler while a plugin owned the storefront's read side). Both land in the
 * one reviews module; the GET serves the customer's own reviews from it.
 * Route-handler harness per the store plugins detail spec.
 */

import { GET as listReviews, POST as createReview } from "../route"
import { REVIEWS_MODULE } from "../../../../modules/reviews"

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, any>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type ReviewRow = Record<string, unknown>

const makeReq = (
  body: Record<string, unknown>,
  behavior: {
    existing?: ReviewRow[]
    storedReviews?: ReviewRow[]
    order?: Record<string, unknown> | null
  } = {}
) => {
  const created: ReviewRow[] = []
  const order =
    behavior.order === undefined
      ? {
          id: "order_1",
          customer_id: "cus_1",
          items: [{ product_id: "prod_1" }, { product_id: "prod_2" }],
        }
      : behavior.order

  const reviewsService = {
    listProductReviews: jest.fn(
      async (filter: Record<string, unknown>, _config?: unknown) => {
        if (filter.customer_id) return behavior.storedReviews ?? []
        return behavior.existing ?? []
      }
    ),
    createProductReviews: jest.fn(async (data: ReviewRow) => {
      const row = { id: "rev_new", created_at: "2026-08-30", updated_at: "2026-08-30", ...data }
      created.push(row)
      return row
    }),
    getSellerAggregate: jest.fn(async () => ({ average: 4.5, count: 2 })),
  }

  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      switch (entity) {
        case "order":
          return { data: order ? [order] : [] }
        case "product":
          return {
            data: [
              { id: "prod_1", seller: { id: "sel_1" } },
              { id: "prod_2", seller: { id: "sel_2" } },
            ],
          }
        case "customer":
          return { data: [{ first_name: "Jordan", last_name: "Rivera" }] }
        case "seller_metadata":
          return { data: [{ id: "smeta_1" }] }
        case "seller":
          return {
            data: [{ id: "sel_1", name: "Seller One", photo: "p.png" }],
          }
        default:
          return { data: [] }
      }
    }),
  }

  const sellerExtension = {
    updateSellerMetadata: jest.fn(async (input: unknown) => input),
  }

  const req = {
    auth_context: { actor_id: "cus_1", actor_type: "customer" },
    body,
    scope: {
      resolve: (key: string) => {
        if (key === REVIEWS_MODULE) return reviewsService
        if (key === "query") return query
        if (key === "sellerExtension") return sellerExtension
        throw new Error(`unexpected resolve: ${key}`)
      },
    },
  }
  return { req: req as any, reviewsService, created }
}

describe("POST /store/reviews — dual dialect", () => {
  it("keeps the FBM product shape working byte-for-byte", async () => {
    const { req, reviewsService } = makeReq({
      order_id: "order_1",
      product_id: "prod_1",
      rating: 5,
      title: "Great",
      body: "Loved it",
    })
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(201)
    const args = reviewsService.createProductReviews.mock.calls[0][0]
    expect(args.subject_type).toBe("product")
    expect(args.product_id).toBe("prod_1")
    expect(args.seller_id).toBe("sel_1")
    expect(res.body.review.author).toBe("Jordan R.")
  })

  it("accepts the storefront's seller-reference dialect and stores a seller-subject review", async () => {
    const { req, reviewsService } = makeReq({
      order_id: "order_1",
      rating: 4,
      reference: "seller",
      reference_id: "sel_2",
      customer_note: "Fast shipping",
    })
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(201)
    const args = reviewsService.createProductReviews.mock.calls[0][0]
    expect(args.subject_type).toBe("seller")
    expect(args.product_id).toBeNull()
    expect(args.seller_id).toBe("sel_2")
    expect(args.body).toBe("Fast shipping")
    expect(res.body.review.customer_note).toBe("Fast shipping")
    expect(res.body.review.reference).toBe("seller")
  })

  it("accepts the product-reference dialect too", async () => {
    const { req, reviewsService } = makeReq({
      order_id: "order_1",
      rating: 3,
      reference: "product",
      reference_id: "prod_2",
      customer_note: "OK",
    })
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(201)
    const args = reviewsService.createProductReviews.mock.calls[0][0]
    expect(args.subject_type).toBe("product")
    expect(args.product_id).toBe("prod_2")
    expect(args.seller_id).toBe("sel_2")
  })

  it("rejects a seller who sold nothing in the order", async () => {
    const { req } = makeReq({
      order_id: "order_1",
      rating: 4,
      reference: "seller",
      reference_id: "sel_elsewhere",
      customer_note: "?",
    })
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/did not sell/)
  })

  it("409s a duplicate seller review for the same order", async () => {
    const { req } = makeReq(
      {
        order_id: "order_1",
        rating: 4,
        reference: "seller",
        reference_id: "sel_1",
        customer_note: "again",
      },
      { existing: [{ id: "rev_prior" }] }
    )
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(409)
  })

  it("400s when neither dialect is satisfied", async () => {
    const { req } = makeReq({ order_id: "order_1", rating: 5 })
    const res = createRes()
    await createReview(req, res as any)
    expect(res.statusCode).toBe(400)
  })
})

describe("GET /store/reviews", () => {
  it("returns the customer's reviews with the storefront's seller join shape", async () => {
    const { req } = makeReq(
      {},
      {
        storedReviews: [
          {
            id: "rev_1",
            subject_type: "seller",
            seller_id: "sel_1",
            order_id: "order_1",
            product_id: null,
            rating: 4,
            body: "Fast shipping",
            title: null,
            created_at: "2026-08-30",
            updated_at: "2026-08-30",
          },
        ],
      }
    )
    const res = createRes()
    await listReviews(req, res as any)
    expect(res.statusCode).toBe(200)
    expect(res.body.reviews).toHaveLength(1)
    expect(res.body.reviews[0]).toMatchObject({
      id: "rev_1",
      reference: "seller",
      customer_note: "Fast shipping",
      seller: { id: "sel_1", name: "Seller One", photo: "p.png" },
    })
  })
})
