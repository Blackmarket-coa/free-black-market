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
    return res.status(200).json({ beneficiaries: [], message: "Donation routing is tier-gated for this storefront" })
  }

  const includeUnverified = req.query.include_unverified === "true"
  const beneficiaries = await donationService.listBeneficiaries(includeUnverified)

  res.status(200).json({ beneficiaries })
}
