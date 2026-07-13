import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { isValidChannel } from "../../../../../modules/order-channel/resolver"
import { OrderChannel } from "../../../../../modules/order-channel/models/order-channel"

type Body = {
  channel?: string
}

/**
 * Declare a cart's order channel pre-completion (roadmap Phase 3A). Mirrors
 * the affiliate attribution stamp (`/store/carts/:id/attribution`): the value
 * is written onto cart.metadata as `order_channel` so it propagates to
 * order.metadata at completion, where the `attribute-channel-on-placed`
 * subscriber records the first-class attribution row. POS / vending / pickup
 * clients call this when they build the cart; the storefront never needs to
 * (unstamped orders default to `online`).
 *
 * Idempotent: re-stamping the same channel is a no-op.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "cart id is required" })

  const body = (req.validatedBody || req.body || {}) as Body
  const raw = (body.channel || "").trim().toLowerCase()
  if (!isValidChannel(raw)) {
    return res.status(400).json({
      message: `channel must be one of: ${Object.values(OrderChannel).join(", ")}`,
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

  const existingMd = (cart.metadata || {}) as Record<string, unknown>
  if (existingMd.order_channel === raw) {
    return res.json({ cart_id: id, order_channel: raw, idempotent: true })
  }

  await cartModule.updateCarts(id, {
    metadata: { ...existingMd, order_channel: raw },
  })

  return res.json({ cart_id: id, order_channel: raw })
}
