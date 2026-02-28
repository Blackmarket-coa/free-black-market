import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const storefront_id = String(req.headers["x-storefront-id"] || "")

  if (!storefront_id) {
    return res.status(400).json({ message: "x-storefront-id header is required" })
  }

  const storefront = await service.retrieveStorefront(storefront_id).catch(() => null)
  if (!storefront || !(storefront.metadata as any)?.sandbox_mode) {
    return res.status(403).json({ message: "Sandbox mode is disabled for this storefront" })
  }

  const simulation = {
    id: `sim_${Date.now()}`,
    status: "simulated",
    payment_provider: "sandbox_test",
    amount: 1999,
    currency_code: "usd",
    created_at: new Date().toISOString(),
  }

  return res.status(200).json({ simulation })
}
