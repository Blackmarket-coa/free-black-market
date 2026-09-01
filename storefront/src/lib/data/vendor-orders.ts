"use server"

import { revalidatePath } from "next/cache"
import { medusaFetch } from "../config"
import { logger } from "../logger"
import { getSellerAuthHeaders } from "./cookies"
import {
  actionableFulfillment,
  shipmentItemsFor,
  sortForVendorInbox,
  type VendorFulfillmentLike,
} from "../helpers/vendor-orders"

/**
 * Vendor order reads/writes for the in-app surface.
 *
 * Every call goes out from the server with the seller bearer from the
 * httpOnly `_fbm_seller_jwt` cookie. This is not a style preference: the
 * MercurJS plugin fronts `/vendor/*` with a CORS allowlist that excludes
 * the storefront origin, so the browser cannot call these endpoints at
 * all — and a seller bearer reaches payout-capable routes, so it should
 * not be in page JS regardless.
 *
 * Field selection matters here. The plugin's default projection is ~49
 * fields including tax lines, adjustments, variants and labels — hundreds
 * of KB over cellular. A plain (unprefixed) `fields` list REPLACES the
 * default, while `+`/`*` prefixes merely add to it, so the list below is
 * deliberately unprefixed. `getVendorOrdersListWorkflow` re-adds whatever
 * it needs to compute `fulfillment_status` / `payment_status`, so those
 * come back even though they are not requested (and cannot be — they are
 * computed, not columns).
 */

const LIST_FIELDS = [
  "id",
  "display_id",
  "status",
  "created_at",
  "total",
  "currency_code",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.city",
  "shipping_address.province",
  // MercurJS computes fulfillment_status from fulfillment timestamps AND
  // items.detail.raw_fulfilled_quantity. `items.*` (which the workflow
  // re-adds) expands the line item's own columns but NOT the detail
  // relation, so without this the partially-fulfilled cases collapse.
  "items.detail.*",
].join(",")

const DETAIL_FIELDS = [
  "id",
  "display_id",
  "status",
  "created_at",
  "total",
  "subtotal",
  "shipping_total",
  "currency_code",
  "email",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.province",
  "shipping_address.postal_code",
  "shipping_address.country_code",
  "shipping_address.phone",
  "fulfillments.id",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.canceled_at",
  "fulfillments.items.line_item_id",
  "fulfillments.items.quantity",
  "items.title",
  "items.thumbnail",
  "items.quantity",
  "items.detail.*",
].join(",")

export type VendorOrderSummary = {
  id: string
  display_id?: number | string | null
  status?: string | null
  fulfillment_status?: string | null
  payment_status?: string | null
  created_at?: string | null
  total?: number | null
  currency_code?: string | null
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    city?: string | null
    province?: string | null
  } | null
  items?: Array<{
    id?: string
    title?: string | null
    thumbnail?: string | null
    quantity?: number | null
  }> | null
}

export type VendorOrderDetail = VendorOrderSummary & {
  email?: string | null
  subtotal?: number | null
  shipping_total?: number | null
  shipping_address?: (VendorOrderSummary["shipping_address"] & {
    address_1?: string | null
    address_2?: string | null
    postal_code?: string | null
    country_code?: string | null
    phone?: string | null
  }) | null
  fulfillments?: VendorFulfillmentLike[] | null
}

export type VendorActionResult = { ok: true } | { ok: false; error: string }

/**
 * The vendor's order inbox. Open work first, oldest first — the order
 * that has been waiting longest is the one most likely to be late.
 *
 * On the window size: `fulfillment_status` is computed per row AFTER the
 * query (it is not a column, so it cannot be filtered or sorted on by the
 * backend). That means open orders can only be found by fetching a page
 * and inspecting it here — and a small page ordered by newest-first would
 * hide exactly the oldest open orders this list is meant to surface. So
 * we pull a deliberately generous window and sort it locally. A vendor
 * with more than this many orders may have older open work beyond the
 * window; the full dashboard remains the exhaustive view.
 */
export async function listVendorOrders(
  limit = 200
): Promise<VendorOrderSummary[]> {
  const headers = await getSellerAuthHeaders()
  if (!headers) return []

  try {
    const res = await medusaFetch<{ orders?: VendorOrderSummary[] }>(
      "/vendor/orders",
      {
        method: "GET",
        query: {
          fields: LIST_FIELDS,
          limit,
          offset: 0,
          order: "-created_at",
        },
        cache: "no-store",
        headers,
      }
    )
    return sortForVendorInbox(res?.orders ?? [])
  } catch (error) {
    logger.error("[vendor-orders] list failed", error)
    return []
  }
}

export async function retrieveVendorOrder(
  orderId: string
): Promise<VendorOrderDetail | null> {
  const headers = await getSellerAuthHeaders()
  if (!headers) return null

  try {
    const res = await medusaFetch<{ order?: VendorOrderDetail }>(
      `/vendor/orders/${orderId}`,
      {
        method: "GET",
        query: { fields: DETAIL_FIELDS },
        cache: "no-store",
        headers,
      }
    )
    return res?.order ?? null
  } catch (error) {
    logger.error("[vendor-orders] retrieve failed", error)
    return null
  }
}

/**
 * Mark the order shipped, recording a tracking number.
 *
 * Items come from the fulfillment itself — the vendor is shipping exactly
 * what they packed, so the phone never asks them to re-key quantities.
 * `tracking_url` / `label_url` are sent as "#" to match what the vendor
 * panel posts (the endpoint requires all three label fields, but a
 * hand-entered tracking number has no URLs).
 */
export async function markVendorOrderShipped(input: {
  orderId: string
  trackingNumber: string
}): Promise<VendorActionResult> {
  const headers = await getSellerAuthHeaders()
  if (!headers) return { ok: false, error: "Your vendor session expired." }

  const trackingNumber = input.trackingNumber?.trim()
  if (!trackingNumber) {
    return { ok: false, error: "Enter a tracking number." }
  }

  const order = await retrieveVendorOrder(input.orderId)
  const fulfillment = actionableFulfillment(order?.fulfillments, "ship")
  if (!fulfillment) {
    return {
      ok: false,
      error:
        "Nothing on this order is packed and waiting to ship. Pack it in the vendor dashboard first.",
    }
  }

  const items = shipmentItemsFor(fulfillment)
  if (items.length === 0) {
    return {
      ok: false,
      error: "Couldn't read the packed items for this order.",
    }
  }

  try {
    await medusaFetch(
      `/vendor/orders/${input.orderId}/fulfillments/${fulfillment.id}/shipments`,
      {
        method: "POST",
        body: {
          items,
          labels: [
            {
              tracking_number: trackingNumber,
              tracking_url: "#",
              label_url: "#",
            },
          ],
        },
        cache: "no-store",
        headers,
      }
    )
    revalidatePath("/[locale]/vendor/orders", "page")
    return { ok: true }
  } catch (error) {
    logger.error("[vendor-orders] mark shipped failed", error)
    return { ok: false, error: "Couldn't mark this order shipped." }
  }
}

/** Confirm delivery / pickup. No body — the fulfillment id is the whole input. */
export async function markVendorOrderDelivered(input: {
  orderId: string
}): Promise<VendorActionResult> {
  const headers = await getSellerAuthHeaders()
  if (!headers) return { ok: false, error: "Your vendor session expired." }

  const order = await retrieveVendorOrder(input.orderId)
  const fulfillment = actionableFulfillment(order?.fulfillments, "deliver")
  if (!fulfillment) {
    return {
      ok: false,
      error: "Nothing on this order has shipped yet, so there is nothing to confirm.",
    }
  }

  try {
    await medusaFetch(
      `/vendor/orders/${input.orderId}/fulfillments/${fulfillment.id}/mark-as-delivered`,
      {
        method: "POST",
        body: {},
        cache: "no-store",
        headers,
      }
    )
    revalidatePath("/[locale]/vendor/orders", "page")
    return { ok: true }
  } catch (error) {
    logger.error("[vendor-orders] mark delivered failed", error)
    return { ok: false, error: "Couldn't mark this order delivered." }
  }
}
