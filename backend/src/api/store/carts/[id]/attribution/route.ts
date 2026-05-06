import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../modules/creator-attribution/service"

type Body = {
  ref_code?: string
  visitor_token?: string
}

/**
 * Stamp affiliate attribution onto a cart. The storefront reads its
 * `_fbm_aff` cookie (already populated by the storefront middleware on
 * `?fbm_ref=`) and POSTs the short code here. We validate the code,
 * resolve the affiliate link, and write the values onto cart.metadata
 * so they propagate to order.metadata at completion. The existing
 * `attribute-order-on-placed` subscriber does the rest.
 *
 * Idempotent: calling repeatedly with the same code is a no-op.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const body = (req.validatedBody || req.body || {}) as Body
  const refCode = (body.ref_code || "").trim()
  if (!refCode) return res.status(400).json({ message: "ref_code is required" })

  const attributionService = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const links = await attributionService.listAffiliateLinks({ short_code: refCode })
  const link = links[0]
  if (!link) {
    return res.status(404).json({ message: "Unknown ref_code" })
  }

  const cartModule: any = req.scope.resolve(Modules.CART)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id },
  })
  const cart = carts?.[0]
  if (!cart) return res.status(404).json({ message: "Cart not found" })

  const existingMd = (cart.metadata || {}) as Record<string, unknown>

  // Idempotency: short-circuit if already stamped with the same code.
  if (existingMd.fbm_short_code === refCode && existingMd.fbm_aff_link_id === link.id) {
    return res.json({ cart_id: id, attribution: existingMd, idempotent: true })
  }

  const nextMd: Record<string, unknown> = {
    ...existingMd,
    fbm_short_code: refCode,
    fbm_aff_link_id: link.id,
  }
  if (body.visitor_token) {
    nextMd.fbm_visitor_token = body.visitor_token
  }

  await cartModule.updateCarts(id, { metadata: nextMd })

  return res.json({ cart_id: id, attribution: nextMd })
}
