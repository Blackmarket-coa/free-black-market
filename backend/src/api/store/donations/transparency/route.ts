import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const donationService = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const tenancyService = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)

  const storefront_id = String(req.headers["x-storefront-id"] || "")
  const context = storefront_id
    ? await tenancyService.resolveContext({ storefront_id })
    : { tier: "tier0_public" as const }

  const gates = tenancyService.featureGatesForTier(context.tier)
  if (!gates.donation_routing) {
    return res.status(403).json({ message: "Transparency endpoint unavailable for current storefront tier" })
  }

  const start = req.query.start_date ? new Date(String(req.query.start_date)) : new Date(Date.now() - 30 * 86400000)
  const end = req.query.end_date ? new Date(String(req.query.end_date)) : new Date()

  const transparency = await donationService.getTransparencySummary(start, end, (req as any).storefront_context?.storefront_id || String(req.headers["x-storefront-id"] || "") || undefined)

  res.status(200).json({ transparency, feature_gates: gates, tier: context.tier })
}
