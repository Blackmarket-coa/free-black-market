import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleContractTransition } from "../transition-handler"

/**
 * POST /v1/seller/services/contracts/:id/start
 * Provider moves an ACTIVE contract to IN_PROGRESS.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handleContractTransition(req, res, "start")
}
