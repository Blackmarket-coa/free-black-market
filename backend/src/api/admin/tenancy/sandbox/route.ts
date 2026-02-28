import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

type Body = { storefront_id: string; enabled: boolean }

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body
  const storefront = await service.setSandboxMode(body.storefront_id, Boolean(body.enabled))
  res.status(200).json({ storefront, sandbox_mode: Boolean((storefront.metadata as any)?.sandbox_mode) })
}
