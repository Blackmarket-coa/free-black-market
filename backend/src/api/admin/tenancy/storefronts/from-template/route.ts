import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import TenancyModuleService from "../../../../../modules/tenancy/service"

type Body = {
  organization_id: string
  storefront_name: string
  storefront_slug: string
  template_key: "food_coop" | "restaurant_collective" | "nonprofit_marketplace"
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body
  const template = service.starterTemplates().find((t) => t.key === body.template_key)

  if (!template) {
    return res.status(404).json({ message: "Template not found" })
  }

  const storefront = await service.createStorefronts({
    organization_id: body.organization_id,
    name: body.storefront_name,
    slug: body.storefront_slug,
    tier: template.tier,
    metadata: {
      template_key: template.key,
      template_defaults: template.defaults,
    },
  })

  await service.ensureOnboardingState(body.organization_id, storefront.id)

  return res.status(200).json({ storefront, template })
}
