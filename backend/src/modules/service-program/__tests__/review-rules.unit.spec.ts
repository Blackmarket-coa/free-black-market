import {
  averageRating,
  validateReviewSubmission,
  REVIEWABLE_CONTRACT_STATUSES,
} from "../review-rules"
import { ServiceContractStatus } from "../models/service-contract"

const contract = (over: Partial<{ status: string; vendor_id: string }> = {}) => ({
  id: "contract_1",
  program_id: "prog_1",
  service_seller_id: "provider_1",
  vendor_id: "client_1",
  status: ServiceContractStatus.ACCEPTED as string,
  ...over,
})

describe("validateReviewSubmission", () => {
  it("accepts a valid review from the client on an accepted contract", () => {
    expect(
      validateReviewSubmission({ contract: contract(), reviewerId: "client_1", rating: 5 })
    ).toEqual({ ok: true })
  })

  it("rejects when the contract is missing", () => {
    const r = validateReviewSubmission({ contract: null, reviewerId: "client_1", rating: 5 })
    expect(r).toMatchObject({ ok: false, code: "not_found" })
  })

  it("rejects non-reviewable contract states", () => {
    for (const status of [
      ServiceContractStatus.ACTIVE,
      ServiceContractStatus.IN_PROGRESS,
      ServiceContractStatus.DELIVERED,
      ServiceContractStatus.DISPUTED,
      ServiceContractStatus.CANCELED,
    ]) {
      const r = validateReviewSubmission({
        contract: contract({ status }),
        reviewerId: "client_1",
        rating: 5,
      })
      expect(r).toMatchObject({ ok: false, code: "not_reviewable" })
    }
    expect(REVIEWABLE_CONTRACT_STATUSES).toEqual([ServiceContractStatus.ACCEPTED])
  })

  it("rejects a reviewer who is not the contract client", () => {
    const r = validateReviewSubmission({
      contract: contract(),
      reviewerId: "provider_1",
      rating: 5,
    })
    expect(r).toMatchObject({ ok: false, code: "not_participant" })
  })

  it("rejects out-of-range or non-integer ratings", () => {
    for (const rating of [0, 6, 3.5, -1, NaN]) {
      const r = validateReviewSubmission({ contract: contract(), reviewerId: "client_1", rating })
      expect(r).toMatchObject({ ok: false, code: "bad_rating" })
    }
  })
})

describe("averageRating", () => {
  it("returns 0 for no reviews", () => {
    expect(averageRating([])).toBe(0)
  })

  it("averages and rounds to 2 decimals, tolerating string ratings", () => {
    expect(averageRating([{ rating: 5 }, { rating: 4 }, { rating: "4" }])).toBe(4.33)
  })
})
