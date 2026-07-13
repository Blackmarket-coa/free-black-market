import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../../types"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_reviewable: 409,
  not_participant: 403,
  bad_rating: 400,
}

/**
 * POST /vendor/service-contracts/:id/reviews
 *
 * The contract's client (authenticated seller) reviews the service provider
 * after the contract is accepted. Rating 1..5; one review per contract (a
 * repeat submission updates it).
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

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)

  try {
    const review = await service.createContractReview({
      contractId: req.params.id,
      reviewerId,
      rating,
      comment,
    })
    return res.status(201).json({ review })
  } catch (err) {
    const code = (err as { code?: string }).code
    const status = (code && ERROR_STATUS[code]) || 500
    return res
      .status(status)
      .json({ message: err instanceof Error ? err.message : "Failed to create review", code })
  }
}
