import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"
import { sellerOwnsProduct } from "../../../../shared/product-sellers"
import { forbidden } from "../../../../shared/community-read-access"

const log = createLogger("api/vendor/bookings/config")

/**
 * GET /vendor/bookings/config?product_id=  — read a product's booking config.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const product_id = String(req.query.product_id || "")
  if (!product_id) {
    return res
      .status(400)
      .json({ message: "product_id is required", type: "invalid_data" })
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const rows = await booking.listProductBookingConfigs(
      { product_id, seller_id: sellerId },
      { take: 1 }
    )
    return res.json({ config: rows?.[0] ?? null })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/bookings/config] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load booking config", type: "server_error" })
  }
}

/**
 * POST /vendor/bookings/config — create/update a product's booking config.
 * Body: { product_id, duration_minutes?, buffer_minutes?, timezone?,
 *         advance_days?, min_notice_hours?, is_active? }
 *
 * `product_id` must be one of the caller's own products (Mercur's
 * seller-product link): 403 otherwise, the same for a product that does not
 * exist. It used to take any product id, so seller B could make seller A's
 * product bookable under B, and since product_id is unique on the table,
 * leave A unable to configure it at all (SD-81 addendum). A row another
 * seller wrote on the caller's product before this check is taken over.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as Record<string, unknown>
  const product_id = String(body.product_id || "")
  if (!product_id) {
    return res
      .status(400)
      .json({ message: "product_id is required", type: "invalid_data" })
  }
  if (!(await sellerOwnsProduct(req.scope, sellerId, product_id))) {
    return forbidden(res)
  }

  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  // Validate timezone via Intl; reject unknown zones so slot math stays sane.
  let timezone = "America/New_York"
  if (typeof body.timezone === "string" && body.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone })
      timezone = body.timezone
    } catch {
      return res
        .status(400)
        .json({ message: "Invalid timezone", type: "invalid_data" })
    }
  }

  const fields = {
    duration_minutes: num(body.duration_minutes, 60, 5, 1440),
    buffer_minutes: num(body.buffer_minutes, 0, 0, 1440),
    timezone,
    advance_days: num(body.advance_days, 30, 1, 365),
    min_notice_hours: num(body.min_notice_hours, 24, 0, 8760),
    is_active: body.is_active !== false,
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const { config, previous_seller_id } = await booking.saveConfigAsProductOwner(
      sellerId,
      product_id,
      fields
    )
    if (previous_seller_id) {
      log.warn(
        `[POST /vendor/bookings/config] seller ${sellerId} took over product ${product_id}'s booking config from seller ${previous_seller_id}`
      )
    }

    return res.json({ config })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/bookings/config] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to save booking config", type: "server_error" })
  }
}
