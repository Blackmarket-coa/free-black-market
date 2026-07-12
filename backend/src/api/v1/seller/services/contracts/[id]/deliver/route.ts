import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleContractTransition } from "../transition-handler"

/**
 * POST /v1/seller/services/contracts/:id/deliver
 * Provider marks the contract DELIVERED (optional `units_delivered`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handleContractTransition(req, res, "deliver")
}
