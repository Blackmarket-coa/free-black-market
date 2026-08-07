/**
 * Timezone-aware period boundaries for the compliance meters.
 *
 * These matter more than they look. A daily meal counter that rolls over at
 * UTC midnight would reset in the middle of dinner service for a cook on the
 * US west coast, and an annual window anchored to the calendar year would be
 * wrong for the majority of sellers, whose permit year starts on whatever
 * month they first registered.
 *
 * Implemented against `Intl` rather than pulling in a date library, since the
 * backend has no date-time dependency today.
 */

const MS_PER_DAY = 86_400_000

/**
 * Milliseconds to add to a UTC instant to get the wall-clock reading in
 * `timeZone`. Derived by formatting the instant in the zone and reinterpreting
 * those wall-clock parts as UTC — the difference is the zone's offset at that
 * moment, DST included.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant)
  } catch {
    // Unknown/invalid zone string — treat as UTC rather than throwing inside a
    // compliance read. A wrong-by-an-offset meter beats a 500.
    return 0
  }

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type)?.value
    const n = found ? Number(found) : 0
    return Number.isFinite(n) ? n : 0
  }

  // h23 still yields 24 for midnight in some ICU builds.
  const hour = get("hour") % 24

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  )
  // Floor to the second — the formatted parts carry no milliseconds.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * A Date whose *UTC* fields read as the wall clock in `timeZone`. Only useful
 * for reading calendar fields; it is not a valid instant on its own.
 */
function toWallClock(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone))
}

/**
 * Inverse of `toWallClock`: turn wall-clock milliseconds back into a real UTC
 * instant. Two passes, because the offset that applies depends on the instant
 * we're solving for — the first guess can land on the wrong side of a DST
 * transition.
 */
function fromWallClock(wallMs: number, timeZone: string): Date {
  const firstGuess = wallMs - zoneOffsetMs(new Date(wallMs), timeZone)
  const refined = wallMs - zoneOffsetMs(new Date(firstGuess), timeZone)
  return new Date(refined)
}

/** Midnight at the start of the day containing `instant`, in `timeZone`. */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone)
  const wallMidnight = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate()
  )
  return fromWallClock(wallMidnight, timeZone)
}

/**
 * Midnight at the start of the week containing `instant`, in `timeZone`.
 *
 * Weeks start Sunday — the convention US food permits use when they cap
 * "meals per week".
 */
export function startOfWeekInZone(instant: Date, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone)
  const wallMidnight = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate()
  )
  const daysSinceSunday = wall.getUTCDay()
  return fromWallClock(wallMidnight - daysSinceSunday * MS_PER_DAY, timeZone)
}

/**
 * Start of the seller's permit year containing `instant`, in `timeZone`.
 *
 * `startMonth` is 1-12. When the current wall-clock month is before it, the
 * period began in the previous calendar year — so a permit year starting in
 * October spans October→September and a sale in the following February still
 * counts against it.
 *
 * `offsetYears` shifts the result by whole permit years; pass 1 to get the
 * exclusive end of the current period.
 */
export function startOfPermitYearInZone(
  instant: Date,
  timeZone: string,
  startMonth: number,
  offsetYears = 0
): Date {
  const month = Math.min(Math.max(Math.trunc(startMonth) || 1, 1), 12)
  const wall = toWallClock(instant, timeZone)
  const currentMonth = wall.getUTCMonth() + 1

  const startYear =
    wall.getUTCFullYear() - (currentMonth < month ? 1 : 0) + offsetYears

  return fromWallClock(Date.UTC(startYear, month - 1, 1), timeZone)
}

/**
 * Whole days from `now` until `date`. Negative once the date has passed, so
 * callers can read `< 0` as expired.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.floor((date.getTime() - now.getTime()) / MS_PER_DAY)
}
