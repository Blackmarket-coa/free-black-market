import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import TenancyModuleService from "../../../../../modules/tenancy/service"

type Body = {
  organization_id: string
  storefront_id: string
  first_listing_created?: boolean
  payout_configured?: boolean
  first_order_simulated?: boolean
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const organization_id = String(req.query.organization_id || "")
  const storefront_id = String(req.query.storefront_id || "")

  if (!organization_id || !storefront_id) {
    return res.status(400).json({ message: "organization_id and storefront_id are required" })
  }

  const state = await service.ensureOnboardingState(organization_id, storefront_id)
  return res.status(200).json({ state })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body

  const existing = await service.ensureOnboardingState(body.organization_id, body.storefront_id)
  const state = await service.updateOnboardingStates({
    id: existing.id,
    first_listing_created: body.first_listing_created ?? existing.first_listing_created,
    payout_configured: body.payout_configured ?? existing.payout_configured,
    first_order_simulated: body.first_order_simulated ?? existing.first_order_simulated,
  })

  return res.status(200).json({ state })
}
