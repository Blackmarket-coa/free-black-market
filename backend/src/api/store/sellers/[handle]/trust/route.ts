import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VENDOR_VERIFICATION_MODULE } from "../../../../../modules/vendor-verification"
import type VendorVerificationService from "../../../../../modules/vendor-verification/service"

/**
 * GET /store/sellers/:handle/trust
 *
 * A seller's public trust summary: verification level, trust score, years
 * active, production scale, and the badges currently granted with their
 * published meaning.
 *
 * The verification module has always been able to produce this
 * (`getTrustSummary`), and the storefront has always had a component able to
 * render it (`molecules/TrustIndicators`). Nothing connected them, so vendor
 * cards showed a bare boolean tick derived from `seller_metadata.verified`
 * while a five-level, fourteen-badge system sat unused behind it.
 *
 * Addressed by handle rather than seller id because that is what every public
 * seller URL already carries.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = (req.params as { handle?: string })?.handle
  if (!handle) {
    return res
      .status(400)
      .json({ message: "Missing seller handle", type: "invalid_request" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "handle"],
    filters: { handle },
  })

  const seller = sellers?.[0]
  if (!seller) {
    return res.status(404).json({ message: "Seller not found", type: "not_found" })
  }

  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const summary = await service.getTrustSummary(seller.id)

  // Cache briefly. Verification changes on a human review cadence, not per
  // request, and this sits on every seller and product page.
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600")
  res.json({ trust: summary })
}
