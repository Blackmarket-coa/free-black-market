import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/analytics/products")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared/auth-helpers"
import {
  mergeProductFunnel,
  productByDayQuery,
  productFunnelQuery,
  productOrdersQuery,
  rangeToWindow,
  type SqlQuery,
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
  // The seller this request acts for. A vendor login's token carries a
  // member id (mem_*), and `_seller_id` is set only for a sel_* token, so
  // reading `_seller_id || actor_id` scoped every member's dashboard to an id
  // no seller has: it answered 200 with zeros (SD-74). requireSellerId maps a
  // member to its seller and answers the request itself when there is none.
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

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

function toRawArgs(q: SqlQuery): [string, SqlQuery["bindings"]] {
  return [q.sql, q.bindings]
}
