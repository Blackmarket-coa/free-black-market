import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/analytics/products")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { VendorRequest } from "../../types"
import {
  mergeProductFunnel,
  productByDayQuery,
  productFunnelQuery,
  productOrdersQuery,
  rangeToWindow,
} from "../../../../modules/creator-attribution/analytics-queries"

/**
 * GET /vendor/analytics/products?range=30
 *
 * Product conversion funnel for the authenticated seller (Phase 4A), read
 * from the Slice B analytics_event table: per-product views/add-to-carts
 * (events) merged with ground-truth orders/units from real order line items
 * (the sales-report join), so conversion = real orders per view.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId =
    (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const window = rangeToWindow((req.query as Record<string, unknown>).range)

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    })
    const productIds: string[] = (
      (sellers?.[0]?.products ?? []) as Array<{ id?: string | null }>
    )
      .map((p) => p?.id)
      .filter((id): id is string => !!id)

    if (productIds.length === 0) {
      return res.status(200).json({
        range_days: window.days,
        funnel: { views: 0, add_to_carts: 0, orders: 0, units: 0, conversion: null },
        by_product: [],
        by_day: [],
      })
    }

    const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const [events, orders, byDay] = await Promise.all([
      pg.raw(...toRawArgs(productFunnelQuery({ productIds, window }))),
      pg.raw(...toRawArgs(productOrdersQuery({ productIds, window }))),
      pg.raw(...toRawArgs(productByDayQuery({ productIds, window }))),
    ])

    const byProduct = mergeProductFunnel(events.rows ?? [], orders.rows ?? [])
    const totals = byProduct.reduce(
      (acc, row) => {
        acc.views += row.views
        acc.add_to_carts += row.add_to_carts
        acc.orders += row.orders
        acc.units += row.units
        return acc
      },
      { views: 0, add_to_carts: 0, orders: 0, units: 0 }
    )

    return res.status(200).json({
      range_days: window.days,
      funnel: {
        ...totals,
        conversion:
          totals.views > 0
            ? Math.round((totals.orders / totals.views) * 10000) / 10000
            : null,
      },
      by_product: byProduct,
      by_day: (byDay.rows ?? []).map((r: Record<string, unknown>) => ({
        date: String(r.date),
        views: Number(r.views) || 0,
        add_to_carts: Number(r.add_to_carts) || 0,
      })),
    })
  } catch (err) {
    log.error("[analytics/products] failed", err)
    return res
      .status(500)
      .json({ message: "Failed to load product analytics", type: "server_error" })
  }
}

function toRawArgs(q: {
  sql: string
  bindings: Array<string | number | Date>
}): [string, Array<string | number | Date>] {
  return [q.sql, q.bindings]
}
