import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"

type Body = {
  name: string
  slug: string
  organization_id: string
  tier?: "tier0_public" | "tier1_verified" | "tier2_aligned_org"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const organization_id = req.query.organization_id ? String(req.query.organization_id) : undefined
  const storefronts = organization_id
    ? await service.listStorefronts({ organization_id })
    : await service.listStorefronts()
  res.status(200).json({ storefronts })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body
  const storefront = await service.createStorefronts({
    name: body.name,
    slug: body.slug,
    organization_id: body.organization_id,
    tier: body.tier || "tier0_public",
  })
  res.status(200).json({ storefront })
}
