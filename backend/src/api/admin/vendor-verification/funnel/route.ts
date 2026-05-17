import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_VERIFICATION_MODULE } from "../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../modules/vendor-verification/service"

/**
 * GET /admin/vendor-verification/funnel
 *
 * Returns the funnel summary the admin Verification page renders:
 * counts by check status, counts by verification level, total
 * verification records, and the median time-to-verify in milliseconds
 * computed across all PASSED checks.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(VENDOR_VERIFICATION_MODULE)
  const funnel = await service.getVerificationFunnel()
  res.json(funnel)
}
