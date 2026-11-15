import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SalesReportResponse } from "../../hooks/api/sales-report"
import { SalesReportPage } from "./sales-report"

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
 * Render the real page with the report already in react-query's cache under
 * the key its hook uses for the default range (the last 30 days ending today,
 * as calendar dates). If the key did not match, the page would render its
 * spinner and every assertion below would fail.
 */
function renderPage(report: SalesReportResponse): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(["sales-report", "2026-10-16", "2026-11-15"], report)
  return text(
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SalesReportPage />
      </QueryClientProvider>
    )
  )
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
