/**
 * Zero-dependency timezone helpers for booking slot generation.
 *
 * Vendor availability is expressed as wall-clock times in the vendor's IANA
 * timezone (e.g. "09:00"–"17:00" in "America/New_York"). To compare those
 * against absolute instants (now, existing bookings stored in UTC) we must
 * convert a wall-clock time in a given zone to a UTC instant — handling the
 * zone's current offset, including DST. We do this with `Intl.DateTimeFormat`
 * (always available in Node) rather than pulling in a timezone library.
 */

/**
 * Offset of `timeZone` from UTC at the instant `date`, in milliseconds
 * (positive when the zone is ahead of UTC). Returns 0 for an invalid zone.
 */
export function tzOffsetMs(timeZone: string, date: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    const parts = dtf.formatToParts(date)
    const m: Record<string, string> = {}
    for (const p of parts) if (p.type !== "literal") m[p.type] = p.value
    const asUTC = Date.UTC(
      Number(m.year),
      Number(m.month) - 1,
      Number(m.day),
      Number(m.hour),
      Number(m.minute),
      Number(m.second)
    )
    return asUTC - date.getTime()
  } catch {
    return 0
  }
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC Date.
 *
 * Two-pass refinement handles DST boundaries: the first guess uses the offset
 * at the naive UTC instant, then we re-evaluate the offset at the corrected
 * instant in case the guess landed on the other side of a transition.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offset1 = tzOffsetMs(timeZone, new Date(guess))
  let utc = guess - offset1
  const offset2 = tzOffsetMs(timeZone, new Date(utc))
  if (offset2 !== offset1) {
    utc = guess - offset2
  }
  return new Date(utc)
}

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD calendar date. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Parse "YYYY-MM-DD" into [year, month, day]; returns null when malformed. */
export function parseDateOnly(
  date: string
): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || "").trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Parse "HH:MM" into [hour, minute]; returns null when malformed. */
export function parseTimeOfDay(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return [h, min]
}
