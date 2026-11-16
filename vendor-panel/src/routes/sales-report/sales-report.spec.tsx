import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Children, type ComponentProps, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type SalesReportResponse,
  salesReportQuery,
  useSalesReport,
} from "../../hooks/api/sales-report"
import { SalesReportPage } from "./sales-report"

// The vendor's time zone (SD-89 (a)): FBM's vendors are in US zones, and the
// bug was reading their calendar dates as UTC days. Node re-reads TZ when it
// is assigned; nothing in this file reads the clock before the tests run, and
// the first test checks the zone took.
const ZONE = "America/Los_Angeles"
const previousTz = process.env.TZ
process.env.TZ = ZONE
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

// Every Button the page renders, so a test can press Export CSV without a
// DOM, and the page's toasts. The real Button still renders.
const ui = vi.hoisted(() => ({
  buttons: [] as Array<{ children?: unknown; onClick?: () => unknown }>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock("@medusajs/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@medusajs/ui")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      ui.buttons.push(props as (typeof ui.buttons)[number])
      return createElement(actual.Button, props)
    },
    toast: { ...actual.toast, success: ui.toastSuccess, error: ui.toastError },
  }
})

// renderToStaticMarkup escapes text, so entities are decoded before matching:
// assertions compare what the vendor reads.
const decode = (s: string) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

const NOW = new Date("2026-11-15T21:17:33.000Z")

const usdLine = {
  line_item_id: "ordli_apron",
  order_id: "order_01JAPRON",
  display_id: 1,
  order_date: "2026-11-15T21:10:00.000Z",
  product_title: "Linen Apron",
  variant_title: "Default",
  variant_sku: "SKU-Linen Apron",
  quantity: 2,
  unit_price: 12.5,
  line_total: 25,
  currency_code: "usd",
  product_id: "prod_apron",
}

/**
 * What GET /vendor/sales-report answers (backend/src/api/vendor/sales-report/
 * route.ts) for one placed order of 2 x $12.50: the response
 * integration-tests/http/vendor-sales-analytics.spec.ts pins on Postgres.
 * Money is in major units.
 */
const usdReport: SalesReportResponse = {
  summary: {
    total_revenue: 25,
    total_orders: 1,
    total_units_sold: 2,
    avg_order_value: 25,
    by_currency: [{ currency_code: "usd", total_revenue: 25, total_orders: 1, avg_order_value: 25 }],
  },
  line_items: [usdLine],
  date_range: { start: "2026-10-16T00:00:00.000Z", end: "2026-11-15T23:59:59.999Z" },
}

/** The same vendor after a EUR 10 order: no cross-currency total. */
const mixedReport: SalesReportResponse = {
  summary: {
    total_revenue: null,
    total_orders: 2,
    total_units_sold: 3,
    avg_order_value: null,
    by_currency: [
      { currency_code: "eur", total_revenue: 10, total_orders: 1, avg_order_value: 10 },
      { currency_code: "usd", total_revenue: 25, total_orders: 1, avg_order_value: 25 },
    ],
  },
  line_items: [
    {
      ...usdLine,
      line_item_id: "ordli_eur",
      order_id: "order_01JEUR",
      display_id: 2,
      quantity: 1,
      unit_price: 10,
      line_total: 10,
      currency_code: "eur",
    },
    usdLine,
  ],
  date_range: usdReport.date_range,
}

const emptyReport: SalesReportResponse = {
  summary: { total_revenue: 0, total_orders: 0, total_units_sold: 0, avg_order_value: 0, by_currency: [] },
  line_items: [],
  date_range: usdReport.date_range,
}

/**
 * The default range at NOW (13:17 on 15 November in Los Angeles): the last 30
 * days ending today, as the instants that bound those local days. 16 October
 * is still on daylight time (UTC-7), 15 November is not (UTC-8).
 */
const DEFAULT_KEY = ["sales-report", "2026-10-16T07:00:00.000Z", "2026-11-16T07:59:59.999Z"]

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })

const renderHtml = (client: QueryClient, element: ReactElement) =>
  renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>)

/**
 * Render the real page with the report already in react-query's cache under
 * the key its hook uses for the default range. If the key did not match, the
 * page would render its spinner and every assertion below would fail.
 */
function renderPage(report: SalesReportResponse): string {
  const client = newClient()
  client.setQueryData(DEFAULT_KEY, report)
  return text(renderHtml(client, <SalesReportPage />))
}

describe("SalesReportPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows the backend's major-unit amounts as they are, not at 1/100", () => {
    const out = renderPage(usdReport)
    expect(out).toContain("Sales Report")
    expect(out).toContain("Total Revenue $25.00")
    expect(out).toContain("Total Orders 1")
    expect(out).toContain("Units Sold 2")
    expect(out).toContain("Avg Order Value $25.00")
    // The line: quantity, unit price, line total.
    expect(out).toContain("Linen Apron Default SKU-Linen Apron 2 $12.50 $25.00")
    // What the page showed while it divided by 100.
    expect(out).not.toContain("$0.25")
    expect(out).not.toContain("$0.13")
  })

  it("formats the summary in the report's currencies, one line each, never as a cross-currency USD total", () => {
    const out = renderPage(mixedReport)
    expect(out).toContain("Total Revenue €10.00 $25.00")
    expect(out).toContain("Avg Order Value €10.00 $25.00")
    expect(out).toContain("Total Orders 2")
    // Each line in its own currency.
    expect(out).toContain("1 €10.00 €10.00")
    expect(out).toContain("2 $12.50 $25.00")
    expect(out).not.toContain("$35.00")
    expect(out).not.toMatch(/NaN|\$0\.00/)
  })

  it("a EUR-only report is in euros, where the summary cards were hard-coded to USD", () => {
    const eurOnly: SalesReportResponse = {
      ...mixedReport,
      summary: {
        total_revenue: 10,
        total_orders: 1,
        total_units_sold: 1,
        avg_order_value: 10,
        by_currency: [mixedReport.summary.by_currency[0]],
      },
      line_items: [mixedReport.line_items[0]],
    }
    const out = renderPage(eurOnly)
    expect(out).toContain("Total Revenue €10.00")
    expect(out).toContain("Avg Order Value €10.00")
    expect(out).not.toContain("$")
  })

  it("with no sales, shows no money rather than a made-up currency", () => {
    const out = renderPage(emptyReport)
    expect(out).toContain("Total Revenue —")
    expect(out).toContain("Avg Order Value —")
    expect(out).toContain("No sales found for the selected date range.")
  })
})

/**
 * SD-89 (a): the dates the report asks for are the vendor's own days. The
 * panel sent date-only values built from the UTC date, and the backend reads a
 * date-only value as a UTC day, so from 4pm Pacific the default end date was
 * already tomorrow's, and a vendor who picked today lost their evening.
 */
describe("SalesReportPage dates in the vendor's zone", () => {
  /** 19:00 on 15 November in Los Angeles: 03:00 on the 16th in UTC. */
  const EVENING = new Date("2026-11-15T19:00:00-08:00")

  const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("format=csv")
      ? new Response("Order ID,Date\n", { status: 200, headers: { "content-type": "text/csv" } })
      : new Response(JSON.stringify(usdReport), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
  )
  /** Each request's query string, as an object. */
  const sent = () =>
    fetchMock.mock.calls.map(([url]) =>
      Object.fromEntries(new URL(String(url), "http://panel.test").searchParams)
    )

  /** Render, then run the one report query the render registered. */
  async function requestFrom(client: QueryClient, element: ReactElement) {
    renderHtml(client, element)
    const queries = client.getQueryCache().findAll({ queryKey: ["sales-report"] })
    expect(queries).toHaveLength(1)
    await queries[0].fetch()
    return { key: queries[0].queryKey, query: sent().at(-1) }
  }

  const ReportFor = ({ start, end }: { start?: string; end?: string }) => {
    useSalesReport({ start_date: start, end_date: end })
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(EVENING)
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
    ui.buttons.length = 0
    ui.toastSuccess.mockClear()
    ui.toastError.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("runs in a US zone, where the local date is still the 15th while UTC is on the 16th", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(ZONE)
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0)
    expect(new Date().getDate()).toBe(15)
    expect(new Date().getUTCDate()).toBe(16)
  })

  it("at 19:00 local, the default range ends today, not tomorrow, and the JSON and CSV requests send the same local-day instants", async () => {
    const client = newClient()
    const { key, query } = await requestFrom(client, <SalesReportPage />)
    const range = { start_date: "2026-10-16T07:00:00.000Z", end_date: "2026-11-16T07:59:59.999Z" }
    expect(query).toEqual(range)
    expect(key).toEqual(DEFAULT_KEY)

    // The date inputs show the vendor's calendar dates.
    const html = renderHtml(client, <SalesReportPage />)
    expect(html).toContain('value="2026-10-16"')
    expect(html).toContain('value="2026-11-15"')
    // An order placed at 18:30 today is inside the window.
    const order = Date.parse("2026-11-15T18:30:00-08:00")
    expect(order).toBeGreaterThanOrEqual(Date.parse(range.start_date))
    expect(order).toBeLessThanOrEqual(Date.parse(range.end_date))

    // Export CSV, from the page as rendered with the report loaded.
    const anchor = { href: "", download: "", click: vi.fn() }
    vi.stubGlobal("window", { URL: { createObjectURL: () => "blob:report", revokeObjectURL: vi.fn() } })
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    })
    const exportCsv = ui.buttons.find((b) => Children.toArray(b.children as never).includes("Export CSV"))
    expect(exportCsv?.onClick).toBeInstanceOf(Function)
    await exportCsv?.onClick?.()
    expect(ui.toastError).not.toHaveBeenCalled()
    expect(ui.toastSuccess).toHaveBeenCalledWith("Sales report CSV downloaded")
    expect(sent()).toEqual([range, { ...range, format: "csv" }])
    expect(anchor.download).toBe("sales-report-2026-10-16-to-2026-11-15.csv")
    expect(anchor.click).toHaveBeenCalledTimes(1)
  })

  it.each([
    // An ordinary day (24 hours), with this evening's 19:00 in it.
    ["2026-11-15", "2026-11-15T08:00:00.000Z", "2026-11-16T07:59:59.999Z", "2026-11-15T19:00:00-08:00"],
    // The day daylight time ends (25 hours) and the day it starts (23).
    ["2026-11-01", "2026-11-01T07:00:00.000Z", "2026-11-02T07:59:59.999Z", "2026-11-01T23:30:00-08:00"],
    ["2026-03-08", "2026-03-08T08:00:00.000Z", "2026-03-09T06:59:59.999Z", "2026-03-08T20:00:00-07:00"],
  ])("a one-day range on %s is that whole local day", async (day, start, end, evening) => {
    const { query } = await requestFrom(newClient(), <ReportFor start={day} end={day} />)
    expect(query).toEqual({ start_date: start, end_date: end })
    // The CSV export builds its request with the same function.
    expect(salesReportQuery({ start_date: day, end_date: day })).toEqual(query)
    // That evening is on the next UTC date, and inside the window.
    expect(new Date(evening).toISOString().slice(0, 10)).not.toBe(day)
    expect(Date.parse(evening)).toBeGreaterThanOrEqual(Date.parse(start))
    expect(Date.parse(evening)).toBeLessThanOrEqual(Date.parse(end))
  })

  it("leaves out an empty date and passes one it cannot read to the backend to refuse", () => {
    expect(salesReportQuery({ start_date: "", end_date: "" })).toEqual({})
    expect(salesReportQuery({ start_date: "2026-02-31", end_date: "garbage" })).toEqual({
      start_date: "2026-02-31",
      end_date: "garbage",
    })
  })
})
