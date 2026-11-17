/**
 * The calendar the vendor sales report's CSV export writes its dates in, read
 * from the optional `time_zone` query parameter.
 *
 * The panel asks for the vendor's own days as instants (SD-89 (a),
 * date-range.ts), but the export's Date column and the file name in
 * Content-Disposition were still each instant's UTC date. For a vendor in Los
 * Angeles an order placed at 19:30 on the 13th is 03:30 UTC on the 14th: it
 * was in the 13th's export, dated the 14th, a date outside the range the
 * vendor chose. `time_zone` names the zone those dates are written in.
 *
 * It changes how a date is WRITTEN, never which orders are counted: the
 * window is still `start_date`/`end_date` (date-range.ts), and a date-only
 * bound is still a UTC day whatever `time_zone` says. With no `time_zone` the
 * dates are UTC dates, as before, so other callers are unchanged.
 *
 * The value is an IANA zone name ("America/Los_Angeles") and nothing else. It
 * is checked by shape first (so a UTC offset such as "-08:00", which
 * Intl.DateTimeFormat accepts but which is not a zone and is wrong on the
 * other side of a DST change, is refused, and so nothing but name characters
 * reaches ICU), then by building an Intl.DateTimeFormat with it, which throws
 * a RangeError for a zone it does not know. The validated name is only ever
 * handed to Intl: dates are formatted here, in JS, and the name is never put
 * into SQL or into a response header.
 */

/** Area/Location segments: letters, digits, `_`, `+`, `-`; starts with a letter. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

export const INVALID_TIME_ZONE_MESSAGE =
  "time_zone must be an IANA time zone name, for example America/Los_Angeles"

export type ReportCalendar = {
  /** The zone dates are written in (its canonical name), or null for UTC dates. */
  timeZone: string | null
  /** A moment's calendar date in that zone, as YYYY-MM-DD. */
  dateOf: (at: Date) => string
}

export type ParsedReportTimeZone =
  | { ok: true; calendar: ReportCalendar }
  | { ok: false; message: string }

/** What the report did before `time_zone` existed: each instant's UTC date. */
const UTC_CALENDAR: ReportCalendar = {
  timeZone: null,
  dateOf: (at) => at.toISOString().split("T")[0],
}

/**
 * A formatter for calendar dates in `zone`, or null when Intl does not know
 * the zone. Gregorian calendar and Latin digits are pinned so the parts are
 * the same numbers on every host.
 */
function zoneFormat(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
  } catch {
    return null
  }
}

/**
 * Read `time_zone`. Absent or empty means UTC dates; a valid IANA name means
 * dates in that zone; anything else (a repeated parameter, an offset, an
 * unknown zone, any other text) is refused, for the route to answer 400.
 */
export function parseReportTimeZone(query: { time_zone?: unknown }): ParsedReportTimeZone {
  const raw = query.time_zone
  if (raw === undefined || raw === "") return { ok: true, calendar: UTC_CALENDAR }

  const refused: ParsedReportTimeZone = { ok: false, message: INVALID_TIME_ZONE_MESSAGE }
  if (typeof raw !== "string" || !ZONE_NAME.test(raw)) return refused
  const format = zoneFormat(raw)
  if (!format) return refused

  return {
    ok: true,
    calendar: {
      timeZone: format.resolvedOptions().timeZone,
      dateOf: (at) => {
        const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
        for (const { type, value } of format.formatToParts(at)) part[type] = value
        return `${(part.year ?? "").padStart(4, "0")}-${part.month}-${part.day}`
      },
    },
  }
}
