import { useQuery } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export type SalesReportLineItem = {
  line_item_id: string
  order_id: string
  display_id: number | null
  order_date: string
  product_title: string
  variant_title: string | null
  variant_sku: string | null
  quantity: number
  unit_price: number
  line_total: number
  currency_code: string
  product_id: string
}

/**
 * One currency's money in the report. Amounts are major units (12.5 is
 * $12.50), as Medusa's order module stores them.
 */
export type SalesReportCurrencyTotal = {
  currency_code: string
  total_revenue: number
  total_orders: number
  avg_order_value: number
}

export type SalesReportSummary = {
  /** Null when the window holds more than one currency: see by_currency. */
  total_revenue: number | null
  total_orders: number
  total_units_sold: number
  /** Null when the window holds more than one currency: see by_currency. */
  avg_order_value: number | null
  /** Money per currency, sorted by code; empty when there are no sales. */
  by_currency: SalesReportCurrencyTotal[]
}

export type SalesReportResponse = {
  summary: SalesReportSummary
  line_items: SalesReportLineItem[]
  date_range: {
    start: string
    end: string
  }
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A moment's calendar date in the browser's own time zone, as YYYY-MM-DD. */
export const toLocalCalendarDate = (at: Date): string =>
  [
    String(at.getFullYear()).padStart(4, "0"),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-")

/**
 * The instant a calendar date starts in the browser's time zone (local
 * midnight), `addDays` days later, or null for a string that is not a real
 * date. `new Date(y, m, d)` reads its fields as local time, so each bound gets
 * the offset in force on its own day, across a DST change too.
 */
const localDayStart = (calendarDate: string, addDays = 0): Date | null => {
  const match = CALENDAR_DATE.exec(calendarDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const at = new Date(year, month, day)
  if (at.getFullYear() !== year || at.getMonth() !== month || at.getDate() !== day) {
    return null
  }
  return addDays ? new Date(year, month, day + addDays) : at
}

/**
 * What GET /vendor/sales-report is sent for a range of calendar dates as the
 * vendor picks them, for the JSON report and the CSV export alike.
 *
 * The backend reads a date-only value as a UTC day
 * (backend/src/api/vendor/sales-report/date-range.ts), and FBM's vendors are
 * in US time zones: sending "2026-11-15" counted 2026-11-15T00:00Z to
 * 2026-11-16T00:00Z, so from 4pm Pacific (5pm in summer) a vendor whose end
 * date was today lost the rest of their day (SD-89 (a)). So each bound goes as
 * the instant it means in the vendor's own zone, as an ISO date-time, which
 * the backend uses as given: `start_date` is local midnight at the start of
 * the start date, and `end_date` is the last millisecond before local midnight
 * after the end date.
 * The backend counts an ISO `end_date` itself (`created_at < end + 1 ms`), so
 * the window ends exactly at that midnight and an order placed at 00:00:00.000
 * the next day is not counted twice.
 *
 * An empty date is left out (the backend defaults it), and a string that is
 * not a calendar date is sent as it is, for the backend to refuse with a 400.
 */
export const salesReportQuery = (range: {
  start_date?: string
  end_date?: string
}): Record<string, string> => {
  const query: Record<string, string> = {}
  if (range.start_date) {
    const start = localDayStart(range.start_date)
    query.start_date = start ? start.toISOString() : range.start_date
  }
  if (range.end_date) {
    const nextDay = localDayStart(range.end_date, 1)
    query.end_date = nextDay ? new Date(nextDay.getTime() - 1).toISOString() : range.end_date
  }
  return query
}

/**
 * The sales report for a range of calendar dates (YYYY-MM-DD, the vendor's own
 * days). The cache key carries the instants actually sent.
 */
export const useSalesReport = (params: {
  start_date?: string
  end_date?: string
}) => {
  const query = salesReportQuery(params)
  const { data, ...rest } = useQuery<SalesReportResponse>({
    queryFn: () =>
      fetchQuery("/vendor/sales-report", {
        method: "GET",
        query,
      }),
    queryKey: ["sales-report", query.start_date, query.end_date],
  })

  return { data, ...rest }
}
