import { MedusaService } from "@medusajs/framework/utils"
import ProductBookingConfig from "./models/product-booking-config"
import VendorAvailability from "./models/vendor-availability"
import Booking, { BookingStatus } from "./models/booking"
import {
  parseDateOnly,
  parseTimeOfDay,
  weekdayOf,
  zonedWallTimeToUtc,
} from "../../shared/timezone"

export type Slot = {
  starts_at: string // ISO UTC
  ends_at: string // ISO UTC
}

export type GenerateSlotsInput = {
  seller_id: string
  product_id: string
  date: string // YYYY-MM-DD, interpreted in the product's timezone
  now?: number // injectable for testing
}

const BLOCKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]

class BookingService extends MedusaService({
  ProductBookingConfig,
  VendorAvailability,
  Booking,
}) {
  /** The active booking config for a product, or null when not bookable. */
  async getConfigForProduct(product_id: string) {
    const rows = await this.listProductBookingConfigs(
      { product_id, is_active: true },
      { take: 1 }
    )
    return rows?.[0] ?? null
  }

  /**
   * Available slots for a product on a given calendar date.
   *
   * Availability windows are wall-clock times in the product's timezone; we
   * convert each candidate slot to a UTC instant, then drop slots that (a) fall
   * inside the min-notice lead time or (b) overlap an existing pending/confirmed
   * booking. Returns [] when the product isn't bookable or has no availability.
   */
  async generateSlots(input: GenerateSlotsInput): Promise<Slot[]> {
    const parsed = parseDateOnly(input.date)
    if (!parsed) return []
    const [year, month, day] = parsed

    const config = await this.getConfigForProduct(input.product_id)
    if (!config) return []

    const tz = config.timezone || "America/New_York"
    const duration = Math.max(5, config.duration_minutes || 60)
    const buffer = Math.max(0, config.buffer_minutes || 0)
    const minNoticeHours = Math.max(0, config.min_notice_hours ?? 24)
    const advanceDays = Math.max(0, config.advance_days ?? 30)

    const now = input.now ?? Date.now()
    const minStartMs = now + minNoticeHours * 3_600_000
    const maxStartMs = now + advanceDays * 86_400_000

    const dow = weekdayOf(year, month, day)
    const windows = await this.listVendorAvailabilities({
      seller_id: input.seller_id,
      day_of_week: dow,
      is_active: true,
    })
    if (!windows?.length) return []

    // Existing bookings that could collide, bounded to this calendar day.
    const dayStart = zonedWallTimeToUtc(year, month, day, 0, 0, tz).getTime()
    const dayEnd = dayStart + 86_400_000
    let existing: { starts_at: Date; ends_at: Date }[] = []
    try {
      existing = (await this.listBookings({
        product_id: input.product_id,
        status: BLOCKING_STATUSES,
        starts_at: { $gte: new Date(dayStart), $lt: new Date(dayEnd) },
      } as any)) as unknown as { starts_at: Date; ends_at: Date }[]
    } catch {
      // If operator filtering isn't supported, fall back to all blocking rows.
      existing = (await this.listBookings({
        product_id: input.product_id,
        status: BLOCKING_STATUSES,
      } as any)) as unknown as { starts_at: Date; ends_at: Date }[]
    }

    const taken = existing.map((b) => ({
      start: new Date(b.starts_at).getTime(),
      end: new Date(b.ends_at).getTime(),
    }))
    const overlaps = (s: number, e: number) =>
      taken.some((t) => s < t.end && e > t.start)

    const stepMs = (duration + buffer) * 60_000
    const durationMs = duration * 60_000
    const slots: Slot[] = []

    for (const w of windows) {
      const start = parseTimeOfDay(w.start_time)
      const end = parseTimeOfDay(w.end_time)
      if (!start || !end) continue

      const windowStartMs = zonedWallTimeToUtc(
        year,
        month,
        day,
        start[0],
        start[1],
        tz
      ).getTime()
      const windowEndMs = zonedWallTimeToUtc(
        year,
        month,
        day,
        end[0],
        end[1],
        tz
      ).getTime()

      for (
        let cursor = windowStartMs;
        cursor + durationMs <= windowEndMs;
        cursor += stepMs
      ) {
        const slotEnd = cursor + durationMs
        if (cursor < minStartMs || cursor > maxStartMs) continue
        if (overlaps(cursor, slotEnd)) continue
        slots.push({
          starts_at: new Date(cursor).toISOString(),
          ends_at: new Date(slotEnd).toISOString(),
        })
      }
    }

    slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return slots
  }

  /**
   * Re-validate that a requested instant is still a real, free slot, then
   * create a pending booking. Returns null when the slot is no longer offered
   * (taken, out of window, or past lead time) so the caller can 409.
   */
  async requestBooking(input: {
    seller_id: string
    product_id: string
    variant_id?: string | null
    starts_at: string // ISO
    customer_email: string
    customer_name?: string | null
    notes?: string | null
    now?: number
  }) {
    const startMs = Date.parse(input.starts_at)
    if (Number.isNaN(startMs)) return null

    const config = await this.getConfigForProduct(input.product_id)
    if (!config) return null

    // The requested instant must be one of the currently-offered slots for its
    // own calendar day (computed in the product's timezone).
    const tz = config.timezone || "America/New_York"
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(startMs))

    const slots = await this.generateSlots({
      seller_id: input.seller_id,
      product_id: input.product_id,
      date: dateStr,
      now: input.now,
    })
    const match = slots.find((s) => Date.parse(s.starts_at) === startMs)
    if (!match) return null

    const created = await this.createBookings({
      seller_id: input.seller_id,
      product_id: input.product_id,
      variant_id: input.variant_id ?? null,
      customer_email: input.customer_email,
      customer_name: input.customer_name ?? null,
      starts_at: new Date(match.starts_at),
      ends_at: new Date(match.ends_at),
      status: BookingStatus.PENDING,
      notes: input.notes ?? null,
    })

    return created
  }
}

export default BookingService
