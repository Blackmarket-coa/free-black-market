import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

type Body = {
  settlement_mode?: "split_processor" | "ledger_batch"
  default_percentage?: number
  round_up_enabled?: boolean
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const settings = await service.getOrCreateDefaultSettings()
  res.status(200).json({ settings })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const body = req.validatedBody || req.body
  const settings = await service.upsertDefaultSettings(body as Record<string, unknown>)
  res.status(200).json({ settings })
}
