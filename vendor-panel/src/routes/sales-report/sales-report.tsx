import { useState } from "react"
import {
  ArrowDownTray,
  ChartBar,
  Spinner,
} from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { useSalesReport } from "../../hooks/api/sales-report"
import { backendUrl, getAuthToken } from "../../lib/client"

const formatCurrency = (amount: number, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount / 100)
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

const getDefaultDateRange = () => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  }
}

export const SalesReportPage = () => {
  const defaults = getDefaultDateRange()
  const [startDate, setStartDate] = useState(defaults.start)
  const [endDate, setEndDate] = useState(defaults.end)
  const [appliedStart, setAppliedStart] = useState(defaults.start)
  const [appliedEnd, setAppliedEnd] = useState(defaults.end)

  const { data, isPending, isError, error } = useSalesReport({
    start_date: appliedStart,
    end_date: appliedEnd,
  })

  const handleApplyFilter = () => {
    setAppliedStart(startDate)
    setAppliedEnd(endDate)
  }

  const handleExportCSV = async () => {
    try {
      const token = getAuthToken()
      const params = new URLSearchParams({
        start_date: appliedStart,
        end_date: appliedEnd,
        format: "csv",
      })

      const response = await fetch(
        `${backendUrl}/vendor/sales-report?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
        }
      )

      if (!response.ok) {
        throw new Error("Failed to download CSV")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `sales-report-${appliedStart}-to-${appliedEnd}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success("Sales report CSV downloaded")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed"
      toast.error(message)
    }
  }

  if (isPending) {
    return (
      <Container className="p-8">
        <div className="flex items-center justify-center h-64">
          <Spinner className="animate-spin h-8 w-8" />
        </div>
      </Container>
    )
  }

  if (isError) {
    return (
      <Container className="p-8">
        <div className="text-center py-8">
          <ChartBar className="h-12 w-12 mx-auto text-ui-fg-muted mb-4" />
          <Heading level="h3" className="mb-2">
            Sales Report Unavailable
          </Heading>
          <Text className="text-ui-fg-muted">
            {error ? String(error) : "Unable to load sales data."}
          </Text>
        </div>
      </Container>
    )
  }

  const summary = data?.summary
  const lineItems = data?.line_items || []

  return (
    <Container className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Heading level="h1" className="text-2xl font-bold mb-2">
            Sales Report
          </Heading>
          <Text className="text-ui-fg-muted">
            View your sales performance and export data
          </Text>
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={handleExportCSV}
          disabled={lineItems.length === 0}
        >
          <ArrowDownTray className="mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Date Filters */}
      <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-y-1">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={handleApplyFilter}
          >
            Apply Filter
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text className="text-ui-fg-muted text-sm">Total Revenue</Text>
            <Text className="text-2xl font-bold">
              {formatCurrency(summary.total_revenue)}
            </Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text className="text-ui-fg-muted text-sm">Total Orders</Text>
            <Text className="text-2xl font-bold">{summary.total_orders}</Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text className="text-ui-fg-muted text-sm">Units Sold</Text>
            <Text className="text-2xl font-bold">
              {summary.total_units_sold}
            </Text>
          </div>
          <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
            <Text className="text-ui-fg-muted text-sm">Avg Order Value</Text>
            <Text className="text-2xl font-bold">
              {formatCurrency(summary.avg_order_value)}
            </Text>
          </div>
        </div>
      )}

      {/* Line Items Table */}
      <div className="bg-ui-bg-base border border-ui-border-base rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Heading level="h2">Sales Details</Heading>
        </div>
        {lineItems.length === 0 ? (
          <div className="text-center py-12">
            <ChartBar className="h-8 w-8 mx-auto text-ui-fg-muted mb-3" />
            <Text className="text-ui-fg-muted">
              No sales found for the selected date range.
            </Text>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                  <th className="text-left px-4 py-3 font-medium text-ui-fg-muted">
                    Order
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-ui-fg-muted">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-ui-fg-muted">
                    Product
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-ui-fg-muted">
                    Variant
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-ui-fg-muted">
                    SKU
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-ui-fg-muted">
                    Qty
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-ui-fg-muted">
                    Unit Price
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-ui-fg-muted">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item: any) => (
                  <tr
                    key={item.line_item_id}
                    className="border-b border-ui-border-base hover:bg-ui-bg-subtle-hover"
                  >
                    <td className="px-4 py-3">
                      <Badge size="2xsmall">
                        #{item.display_id || item.order_id.slice(0, 8)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ui-fg-muted">
                      {formatDate(item.order_date)}
                    </td>
                    <td className="px-4 py-3">{item.product_title}</td>
                    <td className="px-4 py-3 text-ui-fg-muted">
                      {item.variant_title || "-"}
                    </td>
                    <td className="px-4 py-3 text-ui-fg-muted">
                      {item.variant_sku || "-"}
                    </td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">
                      {formatCurrency(item.unit_price, item.currency_code)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(item.line_total, item.currency_code)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Container>
  )
}

export default SalesReportPage
