import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { BOOKING_MODULE } from "../../../modules/booking"
import type BookingService from "../../../modules/booking/service"
import { parseTimeOfDay } from "../../../shared/timezone"

const log = createLogger("api/vendor/availability")

type WindowInput = {
  day_of_week: number
  start_time: string
  end_time: string
  is_active?: boolean
}

/** GET /vendor/availability — this vendor's recurring weekly windows. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService
    const rows = await booking.listVendorAvailabilities(
      { seller_id: sellerId },
      { order: { day_of_week: "ASC", start_time: "ASC" } }
    )
    return res.json({ availability: rows })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/availability] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to load availability", type: "server_error" })
  }
}

/**
 * POST /vendor/availability  { windows: WindowInput[] }
 *
 * Replaces the vendor's entire weekly availability set (full overwrite — the
 * panel always sends the complete grid). Validates day-of-week and HH:MM and
 * that start precedes end.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const windows = ((req.body as { windows?: WindowInput[] })?.windows ?? []) as WindowInput[]
  if (!Array.isArray(windows)) {
    return res
      .status(400)
      .json({ message: "windows must be an array", type: "invalid_data" })
  }

  // Validate before mutating anything.
  const cleaned: Required<WindowInput>[] = []
  for (const w of windows) {
    const dow = Number(w.day_of_week)
    const start = parseTimeOfDay(String(w.start_time))
    const end = parseTimeOfDay(String(w.end_time))
    if (!Number.isInteger(dow) || dow < 0 || dow > 6 || !start || !end) {
      return res.status(400).json({
        message: "Each window needs day_of_week (0-6) and HH:MM start/end times",
        type: "invalid_data",
      })
    }
    if (start[0] * 60 + start[1] >= end[0] * 60 + end[1]) {
      return res.status(400).json({
        message: "start_time must be before end_time",
        type: "invalid_data",
      })
    }
    cleaned.push({
      day_of_week: dow,
      start_time: w.start_time,
      end_time: w.end_time,
      is_active: w.is_active !== false,
    })
  }

  try {
    const booking = req.scope.resolve(BOOKING_MODULE) as BookingService

    // Full overwrite: delete existing windows, then insert the new set.
    const existing = await booking.listVendorAvailabilities({ seller_id: sellerId })
    if (existing.length) {
      await booking.deleteVendorAvailabilities(existing.map((r) => r.id))
    }
    if (cleaned.length) {
      await booking.createVendorAvailabilities(
        cleaned.map((w) => ({ seller_id: sellerId, ...w }))
      )
    }

    const rows = await booking.listVendorAvailabilities(
      { seller_id: sellerId },
      { order: { day_of_week: "ASC", start_time: "ASC" } }
    )
    return res.json({ availability: rows })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/availability] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to save availability", type: "server_error" })
  }
}
