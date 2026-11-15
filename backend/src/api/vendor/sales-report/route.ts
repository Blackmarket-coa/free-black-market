import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared/auth-helpers"
const log = createLogger("api/vendor/sales-report")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PLACED_ORDER_LINES_SQL } from "../../../modules/creator-attribution/analytics-queries"

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

  const { start_date, end_date, format } = req.query as {
    start_date?: string
    end_date?: string
    format?: string
  }

  // Default to last 30 days
  const endDate = end_date ? new Date(end_date as string) : new Date()
  const startDate = start_date
    ? new Date(start_date as string)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

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
        },
        line_items: [],
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      }

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv")
        res.setHeader("Content-Disposition", `attachment; filename="sales-report-${startDate.toISOString().split("T")[0]}-to-${endDate.toISOString().split("T")[0]}.csv"`)
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
        AND o.created_at <= ?
        AND oli.product_id = ANY(?)
      ORDER BY o.created_at DESC, oli.id
    `

    const result = await pgConnection.raw(salesQuery, [
      startDate.toISOString(),
      endDate.toISOString(),
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
        const date = new Date(item.order_date).toISOString().split("T")[0]
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
      res.setHeader("Content-Disposition", `attachment; filename="sales-report-${startDate.toISOString().split("T")[0]}-to-${endDate.toISOString().split("T")[0]}.csv"`)
      return res.send(csvHeader + csvRows)
    }

    return res.json({
      summary: {
        total_revenue: totalRevenue,
        total_orders: totalOrders,
        total_units_sold: totalUnits,
        avg_order_value: avgOrderValue,
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
