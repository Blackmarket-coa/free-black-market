import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import type { EmbedRequest } from "../../../middlewares/embed-key"

const log = createLogger("api/store/embed/bookings")

const DEFAULT_REGION = (
  process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"
).toLowerCase()

function storefrontBase(): string {
  const explicit = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL
  if (explicit) return explicit.replace(/\/$/, "")
  return "https://freeblackmarket.com"
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /store/embed/bookings  (publishable key required)
 *
 * Creates a pending booking for a bookable product after re-validating the
 * requested slot is still free. Returns the booking id plus a checkout deep
 * link the embed can redirect to for paid services (the booking id rides along
 * so the order → booking link can be made on payment). Free/request-only
 * services simply stay "pending" until the vendor confirms from the panel.
 *
 * Body: { product_id, variant_id?, starts_at(ISO), customer_email,
 *         customer_name?, notes? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as EmbedRequest).embed_seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Missing embed context", type: "unauthorized" })
  }

  const body = (req.body ?? {}) as {
    product_id?: string
    variant_id?: string
    starts_at?: string
    customer_email?: string
    customer_name?: string
    notes?: string
  }

  const product_id = String(body.product_id || "")
  const starts_at = String(body.starts_at || "")
  const customer_email = String(body.customer_email || "").trim().toLowerCase()

  if (!product_id || !starts_at || !customer_email) {
    return res.status(400).json({
      message: "product_id, starts_at and customer_email are required",
      type: "invalid_data",
    })
  }
  if (!EMAIL_RE.test(customer_email)) {
    return res
      .status(400)
      .json({ message: "Invalid customer_email", type: "invalid_data" })
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService

    // The product must be bookable AND owned by the key's seller — a key can
    // never create bookings against another vendor's product.
    const config = await booking.getConfigForProduct(product_id)
    if (!config || config.seller_id !== sellerId) {
      return res.status(404).json({
        message: "Product is not bookable for this vendor",
        type: "not_found",
      })
    }

    const created = await booking.requestBooking({
      seller_id: sellerId,
      product_id,
      variant_id: body.variant_id ?? null,
      starts_at,
      customer_email,
      customer_name: body.customer_name?.slice(0, 120) ?? null,
      notes: body.notes?.slice(0, 1000) ?? null,
    })

    if (!created) {
      return res.status(409).json({
        message: "That time is no longer available",
        type: "conflict",
      })
    }

    // Resolve the product handle for the checkout deep link (best effort).
    let handle: string | null = null
    try {
      const query = req.scope.resolve("query")
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["handle"],
        filters: { id: product_id } as any,
      })
      handle = products?.[0]?.handle ?? null
    } catch {
      /* non-fatal */
    }

    const checkout_url = handle
      ? `${storefrontBase()}/${DEFAULT_REGION}/products/${handle}?booking_id=${created.id}`
      : null

    return res.status(201).json({
      booking: {
        id: created.id,
        product_id,
        starts_at: created.starts_at,
        ends_at: created.ends_at,
        status: created.status,
      },
      checkout_url,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /store/embed/bookings] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to create booking", type: "server_error" })
  }
}
