"use server"

import { medusaFetch } from "@/lib/config"
import { addToCart } from "@/lib/data/cart"

/**
 * Order cycles — the CSA-style ordering window a group of producers opens
 * together.
 *
 * Reads come from `/store/order-cycles`, which has existed without a
 * storefront. The write half is the point of this module: an order only counts
 * against a cycle if its line items carry `order_cycle_id`, because
 * `subscribers/order-cycle-order-placed.ts` reads that to record each sale and
 * link the order to the cycle. Until now nothing wrote it, so the subscriber
 * returned early on every order ever placed and a cycle's `sold_quantity`
 * never moved.
 */
export type OrderCycleSummary = {
  id: string
  name: string
  description?: string | null
  opens_at: string
  closes_at: string
  dispatch_at?: string | null
  status: string
  pickup_instructions?: string | null
  pickup_location?: string | null
  product_count: number
  seller_count: number
}

export type OrderCycleVariant = {
  id: string
  title?: string | null
  sku?: string | null
  product?: {
    id: string
    title?: string | null
    description?: string | null
    thumbnail?: string | null
    handle?: string | null
  } | null
}

export type OrderCycleProduct = {
  id: string
  variant_id: string
  effective_price: number | null
  /** Remaining, not the original allowance: the API subtracts sold_quantity. */
  available_quantity: number | null
  has_override_price: boolean
  display_order: number
  variant?: OrderCycleVariant | null
}

export type OrderCycleDetail = {
  order_cycle: OrderCycleSummary & {
    is_open: boolean
    time_until_close: number | null
    time_until_open: number | null
  }
  products: OrderCycleProduct[]
  seller_count: number
}

export async function listOrderCycles(query?: {
  seller_id?: string
  include_upcoming?: string
  limit?: number
  offset?: number
}): Promise<OrderCycleSummary[]> {
  const response = await medusaFetch<{ order_cycles: OrderCycleSummary[] }>(
    "/store/order-cycles",
    { method: "GET", query, cache: "no-store" }
  )

  return response.order_cycles || []
}

export async function getOrderCycle(id: string): Promise<OrderCycleDetail | null> {
  try {
    return await medusaFetch<OrderCycleDetail>(`/store/order-cycles/${id}`, {
      method: "GET",
      cache: "no-store",
    })
  } catch {
    return null
  }
}

/**
 * Ask the cycle whether this item may be ordered, before adding it.
 *
 * Wraps `checkProductAvailability`, which knew every rule that matters — cycle
 * open, product in the cycle and visible, enough left against
 * `available_quantity - sold_quantity` — and had no callers anywhere, so a
 * cycle's stated limits were decorative.
 *
 * Returns the cycle's own wording for a refusal rather than inventing a
 * message, and `max_quantity` when the limit is what failed.
 */
export async function checkCycleAvailability(
  orderCycleId: string,
  variantId: string,
  quantity = 1
): Promise<{
  available: boolean
  reason?: string
  max_quantity?: number
}> {
  return medusaFetch(`/store/order-cycles/${orderCycleId}/availability`, {
    method: "POST",
    body: { variant_id: variantId, quantity },
    cache: "no-store",
  })
}

/**
 * Add a cycle's product to the cart, carrying the cycle on the LINE ITEM.
 *
 * The carrier is the whole point, and it is not cart metadata. FBM checks out
 * through `@mercurjs/b2c-core`, which overrides `POST /store/carts/:id/complete`
 * and builds its order payload by hand — region, customer, items, shipping,
 * promos — without ever copying `cart.metadata` onto the orders. It fetches the
 * field and drops it. Line-item metadata it does carry through
 * (`prepareLineItemData({ ..., metadata: item?.metadata })`), so that is what
 * reaches `subscribers/order-cycle-order-placed.ts` and makes the sale count.
 *
 * Per item is also simply truer: Mercur splits one cart into one order per
 * seller, and `recordSale` works per variant. Each line knows its own cycle, so
 * a cart spanning two cycles records correctly instead of attributing
 * everything to whichever cart-level tag was written last.
 *
 * Availability is checked first, so a refusal costs the buyer nothing — there
 * is no item in the cart to take back out.
 */
export async function addCycleProductToCart({
  orderCycleId,
  variantId,
  quantity,
  countryCode,
}: {
  orderCycleId: string
  variantId: string
  quantity: number
  countryCode: string
}): Promise<{ ok: true } | { ok: false; reason: string; maxQuantity?: number }> {
  const availability = await checkCycleAvailability(orderCycleId, variantId, quantity)

  if (!availability.available) {
    return {
      ok: false,
      reason: availability.reason ?? "This is not available in the cycle right now.",
      ...(availability.max_quantity !== undefined
        ? { maxQuantity: availability.max_quantity }
        : {}),
    }
  }

  await addToCart({
    variantId,
    quantity,
    countryCode,
    metadata: { order_cycle_id: orderCycleId },
  })

  return { ok: true }
}
