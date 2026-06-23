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
  return res.status(200).json({ settings, storefront_context: (req as MedusaRequest & { storefront_context?: { storefront_id?: string; organization_id?: string; role?: string; tier?: string; gates?: Record<string, unknown> } | null }).storefront_context || null })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const body = req.validatedBody || req.body
  const context = (req as MedusaRequest & { storefront_context?: { storefront_id?: string; organization_id?: string; role?: string; tier?: string; gates?: Record<string, unknown> } | null }).storefront_context || null

  if (body.settlement_mode === "ledger_batch" && !context?.gates?.advanced_automation) {
    return res.status(403).json({
      message: "ledger_batch mode requires tier2_aligned_org",
      storefront_tier: context?.tier,
    })
  }

  const settings = await service.upsertDefaultSettings(body as Record<string, unknown>)
  return res.status(200).json({ settings })
}
