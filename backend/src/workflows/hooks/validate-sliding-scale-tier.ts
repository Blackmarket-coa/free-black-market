import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import {
  isSlidingScaleTier,
  SLIDING_SCALE_TIERS,
} from "../../lib/sliding-scale"

/**
 * Validate the sliding-scale tier on cart completion.
 *
 * The storefront writes `cart.metadata.tier` ∈ {"supporter", "standard",
 * "solidarity"} via `POST /store/carts/:id/tier`, which also re-prices
 * eligible line items via `lib/sliding-scale.ts`. This hook is the
 * final guard at order placement: it rejects malformed tier values that
 * could only get there via a direct cart-metadata write (cart.metadata
 * is otherwise free-form, so we can't reject earlier).
 *
 * See `lib/sliding-scale.ts`, `docs/COMPOSITION_LAYER.md`,
 * `docs/PLAYBOOK_SYSTEM.md`.
 */
completeCartWorkflow.hooks.validate(
  async ({ input }, { container }) => {
    const query = container.resolve("query") as {
      graph: (args: {
        entity: string
        fields: string[]
        filters: Record<string, unknown>
      }) => Promise<{ data: any[] }>
    }
    const cartId = (input as { id?: string }).id
    if (!cartId) return

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["metadata"],
      filters: { id: cartId },
    })
    const cart = carts?.[0]
    const tier = (cart?.metadata as Record<string, unknown> | undefined)?.tier
    if (tier === undefined || tier === null) return

    if (!isSlidingScaleTier(tier)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid sliding-scale tier "${String(tier)}". Allowed: ${SLIDING_SCALE_TIERS.join(", ")}.`
      )
    }
  }
)
