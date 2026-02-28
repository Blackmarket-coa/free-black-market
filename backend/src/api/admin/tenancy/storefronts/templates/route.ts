import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import TenancyModuleService from "../../../../../modules/tenancy/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  res.status(200).json({ templates: service.starterTemplates() })
}
