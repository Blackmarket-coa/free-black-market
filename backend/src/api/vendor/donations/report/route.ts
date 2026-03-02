import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const start = req.query.start_date ? new Date(String(req.query.start_date)) : new Date(Date.now() - 30 * 86400000)
  const end = req.query.end_date ? new Date(String(req.query.end_date)) : new Date()

  const report = await service.getTransparencySummary(start, end)
  res.status(200).json({ report })
}
