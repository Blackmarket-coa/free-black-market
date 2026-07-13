import { ServiceContractStatus } from "./models/service-contract"

/**
 * Contract states in which a client may review the provider. Reviews open once
 * the client has accepted the delivered work (terminal success); disputed and
 * canceled contracts are not reviewable.
 */
export const REVIEWABLE_CONTRACT_STATUSES: ReadonlyArray<string> = [
  ServiceContractStatus.ACCEPTED,
]

export type ReviewableContract = {
  id: string
  status: string
  vendor_id: string
  service_seller_id: string
  program_id: string
}

export type ReviewValidationResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "not_reviewable" | "not_participant" | "bad_rating"; message: string }

/**
 * Pure validation for a service-contract review submission. Enforces: the
 * contract exists and is in a reviewable state, the author is the contract's
 * client (`vendor_id`), and the rating is an integer 1..5.
 */
export function validateReviewSubmission(args: {
  contract: ReviewableContract | null | undefined
  reviewerId: string
  rating: number
}): ReviewValidationResult {
  const { contract, reviewerId, rating } = args

  if (!contract) {
    return { ok: false, code: "not_found", message: "Contract not found" }
  }
  if (!REVIEWABLE_CONTRACT_STATUSES.includes(contract.status)) {
    return {
      ok: false,
      code: "not_reviewable",
      message: `Contract must be accepted before it can be reviewed (status: ${contract.status})`,
    }
  }
  if (!reviewerId || contract.vendor_id !== reviewerId) {
    return {
      ok: false,
      code: "not_participant",
      message: "Only the contract's client can review the provider",
    }
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: "bad_rating", message: "Rating must be an integer from 1 to 5" }
  }
  return { ok: true }
}

/** Average rating (rounded to 2 decimals) over a set of reviews. */
export function averageRating(reviews: Array<{ rating: number | string }>): number {
  if (reviews.length === 0) {
    return 0
  }
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0)
  return Math.round((sum / reviews.length) * 100) / 100
}
