import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Validate the sliding-scale tier on cart completion.
 *
 * The storefront writes `cart.metadata.tier` ∈ {"supporter", "standard",
 * "solidarity"} when a non-Stall vendor product is present. This hook
 * rejects malformed values and provides a friendly error.
 *
 * The actual price-list switch per tier is deferred to a follow-up
 * branch that ships three Mercur price-lists per sliding-scale product
 * and selects the matching one in a cart-line pricing hook. v1 stamps
 * the tier on cart metadata so the eventual order carries the buyer's
 * choice for downstream payout accounting.
 *
 * See `docs/COMPOSITION_LAYER.md`, `docs/PLAYBOOK_SYSTEM.md`.
 */
const ALLOWED_TIERS = new Set(["supporter", "standard", "solidarity"])

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

    if (typeof tier !== "string" || !ALLOWED_TIERS.has(tier)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid sliding-scale tier "${String(tier)}". Allowed: ${Array.from(ALLOWED_TIERS).join(", ")}.`
      )
    }
  }
)
