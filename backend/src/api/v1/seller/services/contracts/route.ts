import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"

/**
 * GET /v1/seller/services/contracts
 *
 * List all contracts where this seller is either the service provider or
 * the buyer. Returns both perspectives so the vendor panel can show
 * "Work I'm doing" and "Work I'm buying" tabs from one fetch.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const [asProvider, asBuyer] = await Promise.all([
    service.listServiceContracts({ service_seller_id: sellerId }),
    service.listServiceContracts({ vendor_id: sellerId }),
  ])
  return res.status(200).json({
    as_provider: asProvider,
    as_buyer: asBuyer,
  })
}
