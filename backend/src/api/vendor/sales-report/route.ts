import { createLogger } from "../../../shared/logger"
import type { VendorRequest } from "../types"
const log = createLogger("api/vendor/sales-report")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

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

    // Query order line items for this seller's products
    const placeholders = productIds.map((_, i: number) => `$${i + 3}`).join(", ")
    const salesQuery = `
      SELECT
        oli.id as line_item_id,
        o.id as order_id,
        o.display_id,
        o.created_at as order_date,
        oli.title as product_title,
        oli.variant_title,
        oli.variant_sku,
        oli.quantity,
        oli.unit_price,
        oli.total as line_total,
        o.currency_code,
        oli.product_id
      FROM order_line_item oli
      JOIN "order" o ON oli.order_id = o.id
      WHERE oli.product_id IN (${placeholders})
        AND o.created_at >= $1
        AND o.created_at <= $2
        AND o.canceled_at IS NULL
      ORDER BY o.created_at DESC
    `

    const result = await pgConnection.raw(salesQuery, [
      startDate.toISOString(),
      endDate.toISOString(),
      ...productIds,
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
      const csvRows = lineItems.map((item) => {
        const date = new Date(item.order_date).toISOString().split("T")[0]
        const title = (item.product_title || "").replace(/"/g, '""')
        const variant = (item.variant_title || "").replace(/"/g, '""')
        const sku = (item.variant_sku || "").replace(/"/g, '""')
        const unitPrice = (parseFloat(item.unit_price) / 100).toFixed(2)
        const total = (parseFloat(item.line_total) / 100).toFixed(2)
        return `"${item.display_id || item.order_id}","${date}","${title}","${variant}","${sku}",${item.quantity},${unitPrice},${total},${item.currency_code}`
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
    res.status(500).json({ message: "Failed to fetch sales report", error: error.message })
  }
}
