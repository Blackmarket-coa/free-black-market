/**
 * The window the vendor sales report counts, read from its `start_date` and
 * `end_date` query parameters.
 *
 * The route used to do `new Date(end_date)` and keep `created_at <= end`, but
 * `new Date("2026-11-15")` is midnight UTC at the START of that day, so every
 * order placed on the end date, today's included, was dropped (SD-74
 * follow-up). A calendar date now means the whole UTC day: a date-only
 * `end_date` counts up to the start of the next day.
 *
 * A full ISO 8601 date-time with `Z` or an offset is used as given, and is
 * itself counted (`endExclusive` is one millisecond after it). That is what
 * the vendor panel sends: a UTC day is not the day a US vendor means (from
 * 4pm Pacific their evening is already tomorrow in UTC), so the panel turns
 * the vendor's calendar dates into the instants that bound their own days,
 * local midnight at the start and the last millisecond before local midnight
 * after the end (SD-89 (a); vendor-panel/src/hooks/api/sales-report.ts,
 * salesReportQuery). Date-only values stay accepted, as UTC days, for other
 * callers.
 *
 * Anything else is refused: `new Date("garbage")` is an
 * Invalid Date whose `toISOString()` threw inside the route's try block, so a
 * bad parameter answered 500, and `new Date("2026-02-31")` quietly meant
 * 3 March.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DAYS = 30

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

export type ReportDateRange = {
  /** The first instant counted. */
  start: Date
  /** The first instant NOT counted: the SQL keeps `created_at < endExclusive`. */
  endExclusive: Date
  /** The last millisecond counted, for the response and the CSV file name. */
  end: Date
}

export type ParsedReportDateRange =
  | { ok: true; range: ReportDateRange }
  | { ok: false; message: string }

/** Midnight UTC of a real calendar day, or null ("2026-02-31" is not one). */
function utcDay(year: string, month: string, day: string): number | null {
  const y = Number(year)
  const m = Number(month) - 1
  const d = Number(day)
  const at = Date.UTC(y, m, d)
  const back = new Date(at)
  return back.getUTCFullYear() === y && back.getUTCMonth() === m && back.getUTCDate() === d
    ? at
    : null
}

type Bound = { at: number; dateOnly: boolean }

function parseBound(raw: string): Bound | null {
  const day = DATE_ONLY.exec(raw)
  if (day) {
    const at = utcDay(day[1], day[2], day[3])
    return at === null ? null : { at, dateOnly: true }
  }
  const dateTime = DATE_TIME.exec(raw)
  if (!dateTime || utcDay(dateTime[1], dateTime[2], dateTime[3]) === null) return null
  const at = Date.parse(raw)
  return Number.isFinite(at) ? { at, dateOnly: false } : null
}

/**
 * Parse the report's window. With no `end_date` it ends now; with no
 * `start_date` it starts 30 days before its end.
 */
export function parseReportDateRange(
  query: { start_date?: unknown; end_date?: unknown },
  now: Date = new Date()
): ParsedReportDateRange {
  const bounds: { start_date: Bound | null; end_date: Bound | null } = {
    start_date: null,
    end_date: null,
  }
  for (const name of ["start_date", "end_date"] as const) {
    const raw = query[name]
    if (raw === undefined || raw === "") continue
    const bound = typeof raw === "string" ? parseBound(raw) : null
    if (!bound) {
      return {
        ok: false,
        message: `${name} must be a date (YYYY-MM-DD) or an ISO 8601 date-time with a time zone`,
      }
    }
    bounds[name] = bound
  }

  const end = bounds.end_date
  const endExclusive = !end ? now.getTime() + 1 : end.dateOnly ? end.at + DAY_MS : end.at + 1
  const start = bounds.start_date ? bounds.start_date.at : endExclusive - DEFAULT_DAYS * DAY_MS

  return {
    ok: true,
    range: {
      start: new Date(start),
      endExclusive: new Date(endExclusive),
      end: new Date(endExclusive - 1),
    },
  }
}
