import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type Body = {
  cooperative_id?: string | null
  collective_campaign_id?: string | null
  community_id?: string | null
}

/**
 * Attach a cart to a cooperative / collective-campaign / community so that
 * group-commerce attribution propagates to the placed order via metadata.
 *
 * Idempotent. The actual Order ↔ Cooperative / Campaign links are written
 * by `attribute-order-on-placed` (or its sibling subscribers) when the
 * order completes — we keep this endpoint write-only on cart metadata.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const body = (req.validatedBody || req.body || {}) as Body
  if (
    body.cooperative_id == null &&
    body.collective_campaign_id == null &&
    body.community_id == null
  ) {
    return res.status(400).json({
      message:
        "At least one of cooperative_id, collective_campaign_id, community_id must be provided",
    })
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

  const md = (cart.metadata || {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...md }
  if (body.cooperative_id !== undefined) next.fbm_cooperative_id = body.cooperative_id
  if (body.collective_campaign_id !== undefined)
    next.fbm_collective_campaign_id = body.collective_campaign_id
  if (body.community_id !== undefined) next.fbm_community_id = body.community_id

  await cartModule.updateCarts(id, { metadata: next })
  return res.json({ cart_id: id, group: next })
}
