import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleContractTransition } from "../transition-handler"

/**
 * POST /v1/seller/services/contracts/:id/cancel
 * Client cancels an ACTIVE or IN_PROGRESS contract (→ CANCELED).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handleContractTransition(req, res, "cancel")
}
