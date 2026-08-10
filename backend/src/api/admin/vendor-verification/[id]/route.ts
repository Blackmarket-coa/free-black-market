import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { VENDOR_VERIFICATION_MODULE } from "../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../modules/vendor-verification/service"

/**
 * GET /admin/vendor-verification/:id
 *
 * One seller's verification record: the computed level and trust score, every
 * check with its status and supporting documents, and the badges currently
 * granted. This is what a reviewer reads before deciding a check.
 *
 * `:id` is the seller id, not the verification id — the admin surface and the
 * storefront both address sellers, and `getOrCreateVerification` means a seller
 * with no record yet still resolves rather than 404ing on a reviewer.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const sellerId = (req.params as { id?: string })?.id
  if (!sellerId) {
    return res
      .status(400)
      .json({ message: "Missing seller id", type: "invalid_request" })
  }

  const verification = await service.getOrCreateVerification(sellerId)
  const checks = await service.listVerificationChecks({
    vendor_verification_id: verification.id,
  })
  const badges = await service.listVendorBadges({ seller_id: sellerId })

  res.json({ verification, checks, badges })
}
