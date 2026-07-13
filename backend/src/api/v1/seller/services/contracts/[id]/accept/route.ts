import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleContractTransition } from "../transition-handler"

/**
 * POST /v1/seller/services/contracts/:id/accept
 * Client accepts a DELIVERED contract (→ ACCEPTED). This is the transition that
 * makes the contract reviewable (see `POST /vendor/service-contracts/:id/reviews`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handleContractTransition(req, res, "accept")
}
