import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import TenancyModuleService from "../../../../../modules/tenancy/service"

type Body = {
  organization_id: string
  storefront_name: string
  storefront_slug: string
  template_key: "food_coop" | "restaurant_collective" | "nonprofit_marketplace"
}

const actorFromRequest = (req: MedusaRequest) => {
  const authContext = (req as AuthenticatedMedusaRequest).auth_context as
    | { actor_id?: string; user_id?: string }
    | undefined
  return String(authContext?.actor_id || authContext?.user_id || "")
}

/**
 * Provision a storefront from a starter template.
 *
 * Creates the membership as well as the storefront. Without it the operator who
 * just created the storefront is immediately locked out of it:
 * `requireStorefrontContext` 403s whenever `resolveContext` finds no membership,
 * and nothing else in this flow ever created one — so every donation, settings
 * and report route on the new storefront would deny its own creator. Onboarding
 * that ends in a 403 is not onboarding.
 *
 * `org_owner` because the actor provisioning an organization's storefront is
 * that organization's owner by construction; `ensureMembership` is find-or-
 * create, so a retried request produces one row rather than two.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const body = req.validatedBody || req.body
  const template = service
    .starterTemplatesWithGates()
    .find((t) => t.key === body.template_key)

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

  const actor = actorFromRequest(req)
  const membership = actor
    ? await service.ensureMembership({
        user_id: actor,
        organization_id: body.organization_id,
        storefront_id: storefront.id,
        role: "org_owner",
      })
    : null

  await service.ensureOnboardingState(body.organization_id, storefront.id)

  return res.status(200).json({ storefront, template, membership })
}
