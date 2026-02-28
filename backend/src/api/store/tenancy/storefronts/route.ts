import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const storefronts = await service.listStorefronts()

  res.status(200).json({
    storefronts: storefronts.map((s) => ({
      id: s.id,
      name: s.name,
      organization_id: s.organization_id,
      tier: s.tier,
    })),
  })
}
