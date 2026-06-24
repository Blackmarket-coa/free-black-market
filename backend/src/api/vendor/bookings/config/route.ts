import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared"
import { BOOKING_MODULE } from "../../../../modules/booking"
import type BookingService from "../../../../modules/booking/service"

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
    seller_id: sellerId,
    product_id,
    duration_minutes: num(body.duration_minutes, 60, 5, 1440),
    buffer_minutes: num(body.buffer_minutes, 0, 0, 1440),
    timezone,
    advance_days: num(body.advance_days, 30, 1, 365),
    min_notice_hours: num(body.min_notice_hours, 24, 0, 8760),
    is_active: body.is_active !== false,
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const existing = await booking.listProductBookingConfigs(
      { product_id, seller_id: sellerId },
      { take: 1 }
    )

    let config
    if (existing?.[0]) {
      config = await booking.updateProductBookingConfigs({
        id: existing[0].id,
        ...fields,
      })
    } else {
      config = await booking.createProductBookingConfigs(fields)
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
