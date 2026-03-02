import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { DONATION_MODULE } from "../../../../../modules/donation"
import DonationModuleService from "../../../../../modules/donation/service"

const updateSettingsSchema = z.object({
  default_percentage: z.number().min(0).max(100).optional(),
  round_up_enabled: z.boolean().optional(),
  settlement_mode: z.enum(["direct", "ledger_batch"]).optional(),
  metadata: z.record(z.any()).optional(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const settings = await service.getOrCreateDefaultSettings()
  res.status(200).json({ settings })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
    const payload = updateSettingsSchema.parse(req.body)
    const settings = await service.upsertDefaultSettings(payload)
    res.status(200).json({ settings })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ code: "DONATION_SETTINGS_VALIDATION_ERROR", message: "Validation failed", errors: error.errors })
    }
    throw error
  }
}
