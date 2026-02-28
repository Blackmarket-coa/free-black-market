import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const start = req.query.start_date ? new Date(String(req.query.start_date)) : new Date(Date.now() - 30 * 86400000)
  const end = req.query.end_date ? new Date(String(req.query.end_date)) : new Date()

  const transparency = await service.getTransparencySummary(start, end, (req as any).storefront_context?.storefront_id || undefined)
  res.status(200).json({ report: transparency, storefront_context: (req as any).storefront_context || null })
}
