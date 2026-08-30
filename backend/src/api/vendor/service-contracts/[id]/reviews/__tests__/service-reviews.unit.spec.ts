/**
 * Service-contract reviews after the W4 absorption: eligibility stays with
 * service-program's review-rules, storage moves to the consolidated reviews
 * module (subject_type: service_contract), and both routes keep their
 * historical response shapes. Route-handler harness per the store reviews
 * spec.
 */

import { POST as createContractReview } from "../route"
import { GET as listSellerReviews } from "../../../../../store/service-sellers/[sellerId]/reviews/route"
import { REVIEWS_MODULE } from "../../../../../../modules/reviews"
import { SERVICE_PROGRAM_MODULE } from "../../../../../../modules/service-program"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"

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

const CONTRACT = {
  id: "sc_1",
  status: "accepted",
  vendor_id: "sel_client",
  service_seller_id: "sel_provider",
  program_id: "prog_1",
}

const makeReq = (
  over: Record<string, unknown>,
  behavior: {
    contract?: Record<string, unknown> | null
    existing?: Record<string, unknown>[]
    rows?: Record<string, unknown>[]
  } = {}
) => {
  const serviceProgram = {
    listServiceContracts: jest.fn(async () =>
      behavior.contract === undefined
        ? [CONTRACT]
        : behavior.contract
          ? [behavior.contract]
          : []
    ),
  }
  const reviewsService = {
    listProductReviews: jest.fn(async (filter: Record<string, unknown>) => {
      if (filter.contract_id) return behavior.existing ?? []
      return behavior.rows ?? []
    }),
    createProductReviews: jest.fn(async (data: Record<string, unknown>) => ({
      id: "rev_srv",
      created_at: "2026-08-30",
      updated_at: "2026-08-30",
      ...data,
    })),
    updateProductReviews: jest.fn(async (data: Record<string, unknown>) => ({
      ...(behavior.existing?.[0] ?? {}),
      ...data,
    })),
    getServiceSellerAggregate: jest.fn(async () => ({ average: 4.33, count: 3 })),
  }
  const hawala = {
    recordKarmaEvent: jest.fn(async () => ({ event: { id: "ke_1" }, created: true })),
  }
  const req = {
    _seller_id: "sel_client",
    auth_context: { actor_id: "sel_client" },
    params: { id: "sc_1", sellerId: "sel_provider" },
    body: { rating: 5, comment: "Excellent work" },
    scope: {
      resolve: (key: string) => {
        if (key === SERVICE_PROGRAM_MODULE) return serviceProgram
        if (key === REVIEWS_MODULE) return reviewsService
        if (key === HAWALA_LEDGER_MODULE) return hawala
        throw new Error(`unexpected resolve: ${key}`)
      },
    },
    ...over,
  }
  return { req: req as any, reviewsService, hawala }
}

describe("POST /vendor/service-contracts/:id/reviews", () => {
  it("stores an accepted-contract review in the consolidated module, shaped like the old row", async () => {
    const { req, reviewsService, hawala } = makeReq({})
    const res = createRes()
    await createContractReview(req, res as any)
    expect(res.statusCode).toBe(201)
    const args = reviewsService.createProductReviews.mock.calls[0][0]
    expect(args.subject_type).toBe("service_contract")
    expect(args.seller_id).toBe("sel_provider")
    expect(args.reviewer_seller_id).toBe("sel_client")
    // Historical response contract: service_seller_id / reviewer_id / comment.
    expect(res.body.review).toMatchObject({
      service_seller_id: "sel_provider",
      reviewer_id: "sel_client",
      comment: "Excellent work",
      rating: 5,
    })
    // W4: the five-star first submission credits the provider's karma.
    expect(hawala.recordKarmaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: "sel_provider",
        reason: "review:five_star",
        source_module: "reviews",
      })
    )
  })

  it("updates in place on a repeat submission", async () => {
    const { req, reviewsService } = makeReq(
      {},
      {
        existing: [
          {
            id: "rev_prior",
            contract_id: "sc_1",
            program_id: "prog_1",
            seller_id: "sel_provider",
            reviewer_seller_id: "sel_client",
            rating: 3,
            body: "meh",
          },
        ],
      }
    )
    const res = createRes()
    await createContractReview(req, res as any)
    expect(res.statusCode).toBe(201)
    expect(reviewsService.createProductReviews).not.toHaveBeenCalled()
    expect(reviewsService.updateProductReviews).toHaveBeenCalledWith({
      id: "rev_prior",
      rating: 5,
      body: "Excellent work",
    })
  })

  it("grants no karma on the update path (rating flips must not re-award)", async () => {
    const { req, hawala } = makeReq(
      {},
      { existing: [{ id: "rev_prior", rating: 3 }] }
    )
    const res = createRes()
    await createContractReview(req, res as any)
    expect(res.statusCode).toBe(201)
    expect(hawala.recordKarmaEvent).not.toHaveBeenCalled()
  })

  it("keeps the review-rules gate: a pending contract is not reviewable (409)", async () => {
    const { req, reviewsService } = makeReq(
      {},
      { contract: { ...CONTRACT, status: "pending" } }
    )
    const res = createRes()
    await createContractReview(req, res as any)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe("not_reviewable")
    expect(reviewsService.createProductReviews).not.toHaveBeenCalled()
  })

  it("only the contract's client may review (403)", async () => {
    const { req } = makeReq({ _seller_id: "sel_stranger", auth_context: { actor_id: "sel_stranger" } })
    const res = createRes()
    await createContractReview(req, res as any)
    expect(res.statusCode).toBe(403)
  })
})

describe("GET /store/service-sellers/:sellerId/reviews", () => {
  it("serves the historical shape (2dp average, comment field) from the consolidated module", async () => {
    const { req } = makeReq(
      {},
      {
        rows: [
          {
            id: "rev_srv",
            contract_id: "sc_1",
            program_id: "prog_1",
            seller_id: "sel_provider",
            rating: 4,
            body: "Solid",
            created_at: "2026-08-30",
          },
        ],
      }
    )
    const res = createRes()
    await listSellerReviews(req, res as any)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      seller_id: "sel_provider",
      count: 3,
      average_rating: 4.33,
    })
    expect(res.body.reviews[0]).toMatchObject({
      id: "rev_srv",
      contract_id: "sc_1",
      comment: "Solid",
    })
  })
})
