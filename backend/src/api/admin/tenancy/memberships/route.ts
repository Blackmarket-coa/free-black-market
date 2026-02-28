import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

type Body = {
  user_id: string
  organization_id: string
  storefront_id: string
  role: "org_owner" | "storefront_admin" | "catalog_manager" | "finance_viewer"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const user_id = req.query.user_id ? String(req.query.user_id) : undefined
  const memberships = user_id ? await service.listMemberships({ user_id }) : await service.listMemberships()
  res.status(200).json({ memberships })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body
  const membership = await service.createMemberships(body)
  res.status(200).json({ membership })
}
