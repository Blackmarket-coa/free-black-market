import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../../modules/donation"
import DonationModuleService from "../../../../../modules/donation/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const includeUnverified = req.query.include_unverified === "true"
  const beneficiaries = await service.listBeneficiaries(includeUnverified)
  res.status(200).json({ beneficiaries })
}
