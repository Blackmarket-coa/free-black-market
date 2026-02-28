import { useQuery } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export type SalesReportLineItem = {
  line_item_id: string
  order_id: string
  display_id: string | null
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

export type SalesReportSummary = {
  total_revenue: number
  total_orders: number
  total_units_sold: number
  avg_order_value: number
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
