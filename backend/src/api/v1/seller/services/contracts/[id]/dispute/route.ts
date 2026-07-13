import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleContractTransition } from "../transition-handler"

/**
 * POST /v1/seller/services/contracts/:id/dispute
 * Either party disputes the contract (→ DISPUTED). Requires `reason`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handleContractTransition(req, res, "dispute")
}
