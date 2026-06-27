/**
 * Pure availability math for wellness sessions — extracted so it can be unit
 * tested without a database. The `booking` module owns the DB-backed
 * `generateSlots`; this mirrors that logic over plain inputs so the wellness
 * layer can compute slots for a session type (which may have its own
 * buffer/duration) using the practitioner's weekly availability windows.
 *
 * Availability windows are wall-clock times in the practitioner's IANA
 * timezone. Existing bookings are absolute instants. A candidate slot is
 * dropped when it (a) falls inside the min-notice lead time, (b) is beyond the
 * advance-booking horizon, or (c) overlaps an existing booking.
 */
import {
  parseDateOnly,
  parseTimeOfDay,
  weekdayOf,
  zonedWallTimeToUtc,
} from "../../shared/timezone"

export interface AvailabilityWindow {
  day_of_week: number // 0=Sun … 6=Sat
  start_time: string // "HH:MM"
  end_time: string // "HH:MM"
}

export interface ExistingBooking {
  starts_at: string | Date
  ends_at: string | Date
}

export interface SlotOptions {
  duration_minutes: number
  buffer_minutes?: number
  min_notice_hours?: number
  advance_days?: number
  timezone?: string
  now?: number // injectable for testing
}

export interface AvailableSlot {
  starts_at: string // ISO UTC
  ends_at: string // ISO UTC
}

/**
 * Compute the bookable slots for a single calendar `date` (YYYY-MM-DD,
 * interpreted in `opts.timezone`). Pure: same inputs → same output.
 */
export function getAvailableSlots(
  availability: AvailabilityWindow[],
  bookings: ExistingBooking[],
  date: string,
  opts: SlotOptions
): AvailableSlot[] {
  const parsed = parseDateOnly(date)
  if (!parsed) return []
  const [year, month, day] = parsed

  const tz = opts.timezone || "America/New_York"
  const duration = Math.max(5, opts.duration_minutes || 60)
  const buffer = Math.max(0, opts.buffer_minutes || 0)
  const minNoticeHours = Math.max(0, opts.min_notice_hours ?? 24)
  const advanceDays = Math.max(0, opts.advance_days ?? 30)

  const now = opts.now ?? Date.now()
  const minStartMs = now + minNoticeHours * 3_600_000
  const maxStartMs = now + advanceDays * 86_400_000

  const dow = weekdayOf(year, month, day)
  const windows = availability.filter((w) => w.day_of_week === dow)
  if (!windows.length) return []

  const taken = bookings.map((b) => ({
    start: new Date(b.starts_at).getTime(),
    end: new Date(b.ends_at).getTime(),
  }))
  const overlaps = (s: number, e: number) =>
    taken.some((t) => s < t.end && e > t.start)

  const stepMs = (duration + buffer) * 60_000
  const durationMs = duration * 60_000
  const slots: AvailableSlot[] = []

  for (const w of windows) {
    const start = parseTimeOfDay(w.start_time)
    const end = parseTimeOfDay(w.end_time)
    if (!start || !end) continue

    const windowStartMs = zonedWallTimeToUtc(year, month, day, start[0], start[1], tz).getTime()
    const windowEndMs = zonedWallTimeToUtc(year, month, day, end[0], end[1], tz).getTime()

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
