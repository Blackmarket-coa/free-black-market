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

export const useSalesReport = (params: {
  start_date?: string
  end_date?: string
}) => {
  const { data, ...rest } = useQuery<SalesReportResponse>({
    queryFn: () =>
      fetchQuery("/vendor/sales-report", {
        method: "GET",
        query: {
          ...(params.start_date ? { start_date: params.start_date } : {}),
          ...(params.end_date ? { end_date: params.end_date } : {}),
        } as Record<string, string>,
      }),
    queryKey: ["sales-report", params.start_date, params.end_date],
  })

  return { data, ...rest }
}
