import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared/auth-helpers"
const log = createLogger("api/vendor/sales-report")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PLACED_ORDER_LINES_SQL } from "../../../modules/creator-attribution/analytics-queries"
import { parseReportDateRange } from "./date-range"
import { parseReportTimeZone } from "./time-zone"

/**
 * One CSV field: quoted, with embedded quotes doubled, and a leading
 * `=`, `+`, `-` or `@` neutralised so a spreadsheet does not run a product
 * title as a formula.
 */
function csvField(value: unknown): string {
  const text = value == null ? "" : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** A money amount as the order module stores it (major units), to 2 places. */
function money(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : "0.00"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  // The seller this request acts for. A vendor login's token carries a
  // member id (mem_*), and `_seller_id` is set only for a sel_* token, and this
  // route resolved it with its own copy of the lookup. requireSellerId maps a
  // member to its seller and answers the request itself when there is none.
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const { format } = req.query as { format?: string }

  // The panel sends the instants that bound the vendor's local days; a
  // date-only end_date is the whole of that UTC day (it used to be read as its
  // first instant, which left out every order placed on it). See
  // date-range.ts.
  const parsed = parseReportDateRange(req.query)
  if (!parsed.ok) {
    return res.status(400).json({ type: "invalid_data", message: parsed.message })
  }
  const { start: startDate, end: endDate, endExclusive } = parsed.range

  // The zone the CSV writes its dates in (SD-89). The window above is the
  // vendor's local days as instants, but the export's Date column and file
  // name were each instant's UTC date, so a Los Angeles day's evening orders
  // were dated the next day, outside the range the vendor chose. With a
  // `time_zone` (an IANA name, validated in time-zone.ts and only ever handed
  // to Intl) both are written in that zone; without one they are UTC dates as
  // before. The JSON response is unchanged: its order_date is the instant,
  // which the panel renders in the browser's zone.
  const zone = parseReportTimeZone(req.query)
  if (!zone.ok) {
    return res.status(400).json({ type: "invalid_data", message: zone.message })
  }
  const { calendar } = zone
  const csvFileName = `sales-report-${calendar.dateOf(startDate)}-to-${calendar.dateOf(endDate)}.csv`

  try {
    // Get product IDs owned by this seller
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: sellerProducts } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })

    const productIds =
      sellerProducts?.[0]?.products
        ?.map((p) => p?.id)
        .filter((id): id is string => Boolean(id)) || []

    if (productIds.length === 0) {
      const emptyResult = {
        summary: {
          total_revenue: 0,
          total_orders: 0,
          total_units_sold: 0,
          avg_order_value: 0,
          by_currency: [],
        },
        line_items: [],
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      }

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv")
        res.setHeader("Content-Disposition", `attachment; filename="${csvFileName}"`)
        return res.send("Order ID,Date,Product,Variant,SKU,Quantity,Unit Price,Total,Currency\n")
      }

      return res.json(emptyResult)
    }

    // The seller's lines on placed orders. Medusa 2 keeps a line's quantity
    // on order_item (per order version) and has no line total column, so the
    // line total is quantity x unit price, the gross before tax and
    // discounts. Money is in major units, as the order module stores it.
    //
    // This used to select order_line_item.order_id, .quantity and .total,
    // none of which exist, through Postgres `$n` placeholders that knex's
    // raw does not bind ("Expected N bindings, saw 0"), so the report and its
    // CSV answered 500 for every seller with a product (SD-74).
    const salesQuery = `
      SELECT
        oli.id AS line_item_id,
        o.id AS order_id,
        o.display_id,
        o.created_at AS order_date,
        COALESCE(oli.product_title, oli.title) AS product_title,
        oli.variant_title,
        oli.variant_sku,
        oi.quantity,
        COALESCE(oi.unit_price, oli.unit_price) AS unit_price,
        oi.quantity * COALESCE(oi.unit_price, oli.unit_price) AS line_total,
        o.currency_code,
        oli.product_id
      ${PLACED_ORDER_LINES_SQL}
        AND o.created_at >= ?
        AND o.created_at < ?
        AND oli.product_id = ANY(?)
      ORDER BY o.created_at DESC, oli.id
    `

    const result = await pgConnection.raw(salesQuery, [
      startDate.toISOString(),
      endExclusive.toISOString(),
      productIds,
    ])

    const lineItems = result.rows || []

    // Calculate summary
    const totalRevenue = lineItems.reduce((sum: number, item) => sum + (parseFloat(item.line_total) || 0), 0)
    const totalUnits = lineItems.reduce((sum: number, item) => sum + (parseInt(item.quantity) || 0), 0)
    const uniqueOrders = new Set(lineItems.map((item) => item.order_id))
    const totalOrders = uniqueOrders.size
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    if (format === "csv") {
      const csvHeader = "Order ID,Date,Product,Variant,SKU,Quantity,Unit Price,Total,Currency\n"
      // Amounts are major units already; the old `/ 100` showed a $12.50
      // line as 0.13.
      const csvRows = lineItems.map((item) => {
        const date = calendar.dateOf(new Date(item.order_date))
        return [
          csvField(item.display_id || item.order_id),
          csvField(date),
          csvField(item.product_title),
          csvField(item.variant_title),
          csvField(item.variant_sku),
          Number(item.quantity) || 0,
          money(item.unit_price),
          money(item.line_total),
          csvField(item.currency_code),
        ].join(",")
      }).join("\n")

      res.setHeader("Content-Type", "text/csv")
      res.setHeader("Content-Disposition", `attachment; filename="${csvFileName}"`)
      return res.send(csvHeader + csvRows)
    }

    // Money per currency. An order is in one currency, but a seller who sells
    // in two regions has lines in two, and $25 plus EUR 10 is not 35 of
    // anything. The single-currency totals stay where they were; with more
    // than one currency in the window they are null and by_currency carries
    // the figures (the panel always formats from by_currency).
    const currencyTotals = new Map<string, { revenue: number; orders: Set<string> }>()
    for (const item of lineItems) {
      const code = String(item.currency_code ?? "").toLowerCase()
      const entry = currencyTotals.get(code) ?? { revenue: 0, orders: new Set<string>() }
      entry.revenue += parseFloat(item.line_total) || 0
      entry.orders.add(item.order_id)
      currencyTotals.set(code, entry)
    }
    const byCurrency = [...currencyTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency_code, entry]) => ({
        currency_code,
        total_revenue: entry.revenue,
        total_orders: entry.orders.size,
        avg_order_value: entry.orders.size > 0 ? entry.revenue / entry.orders.size : 0,
      }))
    const oneCurrency = byCurrency.length <= 1

    return res.json({
      summary: {
        total_revenue: oneCurrency ? totalRevenue : null,
        total_orders: totalOrders,
        total_units_sold: totalUnits,
        avg_order_value: oneCurrency ? avgOrderValue : null,
        by_currency: byCurrency,
      },
      line_items: lineItems.map((item) => ({
        line_item_id: item.line_item_id,
        order_id: item.order_id,
        display_id: item.display_id,
        order_date: item.order_date,
        product_title: item.product_title,
        variant_title: item.variant_title,
        variant_sku: item.variant_sku,
        quantity: parseInt(item.quantity) || 0,
        unit_price: parseFloat(item.unit_price) || 0,
        line_total: parseFloat(item.line_total) || 0,
        currency_code: item.currency_code,
        product_id: item.product_id,
      })),
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    log.error(`Error fetching sales report for seller ${sellerId}:`, error)
    res.status(500).json({ message: "Failed to fetch sales report" })
  }
}
