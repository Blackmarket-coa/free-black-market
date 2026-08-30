import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../../types"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"
import { validateReviewSubmission } from "../../../../../modules/service-program/review-rules"
import { REVIEWS_MODULE } from "../../../../../modules/reviews"
import type ReviewsService from "../../../../../modules/reviews/service"
import { ReviewSubjectType } from "../../../../../modules/reviews/models/product-review"

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_reviewable: 409,
  not_participant: 403,
  bad_rating: 400,
}

/** Present a consolidated review row in the historical service-review shape. */
function toServiceReviewShape(row: {
  id: string
  contract_id?: string | null
  program_id?: string | null
  seller_id: string
  reviewer_seller_id?: string | null
  rating: number
  body?: string | null
  created_at?: unknown
  updated_at?: unknown
}) {
  return {
    id: row.id,
    contract_id: row.contract_id,
    program_id: row.program_id,
    service_seller_id: row.seller_id,
    reviewer_id: row.reviewer_seller_id,
    rating: Number(row.rating),
    comment: row.body ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * POST /vendor/service-contracts/:id/reviews
 *
 * The contract's client (authenticated seller) reviews the service provider
 * after the contract is accepted. Rating 1..5; one review per contract (a
 * repeat submission updates it).
 *
 * W4: eligibility stays with service-program (`review-rules.ts` against the
 * live contract), but the review row lands in the consolidated reviews
 * module (`subject_type: service_contract`). Response shape unchanged.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const reviewerId =
    (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  if (!reviewerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const body = (req.body ?? {}) as { rating?: unknown; comment?: unknown }
  const rating = Number(body.rating)
  const comment = typeof body.comment === "string" ? body.comment : null

  const serviceProgram = req.scope.resolve<ServiceProgramService>(
    SERVICE_PROGRAM_MODULE
  )
  const reviews = req.scope.resolve<ReviewsService>(REVIEWS_MODULE)

  try {
    const [contract] = await serviceProgram.listServiceContracts({
      id: req.params.id,
    })

    const validation = validateReviewSubmission({
      contract: contract
        ? {
            id: contract.id,
            status: contract.status,
            vendor_id: contract.vendor_id,
            service_seller_id: contract.service_seller_id,
            program_id: contract.program_id,
          }
        : null,
      reviewerId,
      rating,
    })
    if (!validation.ok) {
      return res
        .status(ERROR_STATUS[validation.code] ?? 500)
        .json({ message: validation.message, code: validation.code })
    }

    const [existing] = await reviews.listProductReviews(
      {
        contract_id: req.params.id,
        reviewer_seller_id: reviewerId,
        subject_type: ReviewSubjectType.SERVICE_CONTRACT,
      },
      { take: 1 }
    )
    if (existing) {
      const updated = await reviews.updateProductReviews({
        id: existing.id,
        rating,
        body: comment,
      })
      const row = Array.isArray(updated) ? updated[0] : updated
      return res.status(201).json({
        review: toServiceReviewShape(row as Parameters<typeof toServiceReviewShape>[0]),
      })
    }

    const created = await reviews.createProductReviews({
      subject_type: ReviewSubjectType.SERVICE_CONTRACT,
      seller_id: contract.service_seller_id,
      contract_id: contract.id,
      program_id: contract.program_id,
      reviewer_seller_id: reviewerId,
      rating,
      body: comment,
      is_verified: true,
    })
    return res.status(201).json({
      review: toServiceReviewShape(created as Parameters<typeof toServiceReviewShape>[0]),
    })
  } catch (err) {
    return res.status(500).json({
      message: err instanceof Error ? err.message : "Failed to create review",
    })
  }
}
