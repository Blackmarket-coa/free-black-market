import { MedusaService } from "@medusajs/framework/utils"
import EmbedEvent from "./models/embed-event"

/** Event types connect.js emits. Free-form, but these drive the funnel. */
export const EMBED_EVENT_TYPES = [
  "view",
  "product_view",
  "add_to_cart",
  "checkout_start",
  "order_complete",
  "booking_open",
  "booking_confirm",
  "chat_open",
] as const

export type EmbedAnalytics = {
  range_days: number
  totals: Record<string, number>
  funnel: {
    views: number
    add_to_cart: number
    checkout_start: number
    orders: number
  }
  by_origin: { origin: string; count: number }[]
  by_day: { date: string; views: number; orders: number }[]
  top_products: { product_id: string; views: number }[]
}

class EmbedAnalyticsService extends MedusaService({
  EmbedEvent,
}) {
  /**
   * Aggregate a seller's embed events over the last `rangeDays`. Computed in
   * memory from a bounded fetch — fine for per-vendor dashboards.
   */
  async aggregateForSeller(
    seller_id: string,
    rangeDays = 30,
    now = Date.now()
  ): Promise<EmbedAnalytics> {
    const since = new Date(now - rangeDays * 86_400_000)
    const rows = (await this.listEmbedEvents(
      { seller_id, created_at: { $gte: since } } as any,
      { take: 100_000, order: { created_at: "ASC" } }
    )) as unknown as {
      event_type: string
      origin: string | null
      product_id: string | null
      created_at: Date
    }[]

    const totals: Record<string, number> = {}
    const originCounts = new Map<string, number>()
    const productViews = new Map<string, number>()
    const dayMap = new Map<string, { views: number; orders: number }>()

    for (const r of rows) {
      totals[r.event_type] = (totals[r.event_type] || 0) + 1

      if (r.origin) {
        originCounts.set(r.origin, (originCounts.get(r.origin) || 0) + 1)
      }
      if (r.event_type === "product_view" && r.product_id) {
        productViews.set(
          r.product_id,
          (productViews.get(r.product_id) || 0) + 1
        )
      }

      const day = new Date(r.created_at).toISOString().slice(0, 10)
      const bucket = dayMap.get(day) || { views: 0, orders: 0 }
      if (r.event_type === "view") bucket.views++
      if (r.event_type === "order_complete") bucket.orders++
      dayMap.set(day, bucket)
    }

    const by_origin = [...originCounts.entries()]
      .map(([origin, count]) => ({ origin, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    const top_products = [...productViews.entries()]
      .map(([product_id, views]) => ({ product_id, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)

    const by_day = [...dayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      range_days: rangeDays,
      totals,
      funnel: {
        views: totals["view"] || 0,
        add_to_cart: totals["add_to_cart"] || 0,
        checkout_start: totals["checkout_start"] || 0,
        orders: totals["order_complete"] || 0,
      },
      by_origin,
      by_day,
      top_products,
    }
  }
}

export default EmbedAnalyticsService
