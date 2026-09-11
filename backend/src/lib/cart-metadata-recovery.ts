import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../shared/logger"

const log = createLogger("lib/cart-metadata-recovery")

/**
 * Read the metadata a buyer's cart carried, from an order.
 *
 * **Cart metadata does not survive FBM's main checkout path.**
 * `@mercurjs/b2c-core` overrides `POST /store/carts/:id/complete` with
 * `splitAndCompleteCartWorkflow`, which builds its order payload by hand —
 * region, customer, sales channel, addresses, items, shipping methods — and
 * has no `metadata` key at all. Line-item and shipping-method metadata are
 * carried; the cart's own is dropped. FBM's other completion routes wrap
 * Medusa's `completeCartWorkflow`, which does propagate, so behaviour differs
 * by checkout path. Recorded as D9-5 in docs/AUDIT_DEBT.md.
 *
 * That is a vendored dependency, so this recovers rather than patches. The
 * same workflow calls `createOrderSetStep({ cart_id: cart.id, ... })`, and
 * `order_set` is linked to its orders, so the originating cart is reachable
 * from any order it produced: order → order_set → cart_id → cart.metadata.
 *
 * **Order metadata still wins.** A checkout path that propagated correctly
 * has the freshest value on the order itself, and an operator may have edited it
 * after the fact; the cart is the fallback, not the source of truth.
 *
 * Never throws. A consumer of this is a subscriber reacting to `order.placed`,
 * and failing to recover an optional preference must not fail the order.
 */
export async function getOrderCartMetadata(
  container: MedusaContainer,
  order: { id: string; metadata?: Record<string, unknown> | null },
  /** Keys the caller needs. The cart read is skipped only when the order has them all. */
  keys: readonly string[]
): Promise<Record<string, unknown>> {
  const onOrder = (order.metadata ?? {}) as Record<string, unknown>

  // Cheap exit, and deliberately on EVERY key rather than any one of them.
  // The merge below is per key — the order wins where it has a value, the
  // cart fills the rest — and short-circuiting on a single present key would
  // contradict that: an order carrying `fbm_short_code` but not
  // `fbm_visitor_token` would silently lose the token the cart still had.
  // Skipping the read is an optimization, so it may only apply where the read
  // could not have added anything.
  const has = (key: string) => onOrder[key] !== undefined && onOrder[key] !== null
  if (keys.every(has)) {
    return onOrder
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Traversed from the order rather than filtered from `order_set`.
    // `filters: { orders: { id } }` works at runtime but `RemoteQueryFilters`
    // only accepts direct fields of the filtered entity, so it fails the
    // generated-type build even though plain `tsc` lets it through. The
    // order side carries a singular `order_set` alias, which asks the same
    // question without a nested filter.
    const { data: rows } = await query.graph({
      entity: "order",
      fields: ["order_set.cart_id"],
      filters: { id: order.id },
    })

    const cartId = (
      rows?.[0] as { order_set?: { cart_id?: string } | null } | undefined
    )?.order_set?.cart_id
    if (!cartId) {
      return onOrder
    }

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["metadata"],
      filters: { id: cartId },
    })

    const fromCart = ((carts?.[0] as { metadata?: Record<string, unknown> } | undefined)
      ?.metadata ?? {}) as Record<string, unknown>

    // Order wins on any key it does carry.
    return { ...fromCart, ...onOrder }
  } catch (error) {
    log.warn(
      `[cart-metadata-recovery] could not recover cart metadata for order ${order.id}: ${
        (error as Error)?.message ?? error
      }`
    )
    return onOrder
  }
}
