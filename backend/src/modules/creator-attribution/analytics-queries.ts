/**
 * Pure SQL builders + row mappers for the Phase 4A analytics dashboards.
 * Every function returns `{ sql, bindings }` for knex's `raw`, filters on
 * `deleted_at IS NULL`, and requires an explicit date window — no I/O here so
 * the shapes are unit-testable. Routes execute them via
 * `req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(sql, bindings)`.
 *
 * Placeholders are knex's `?`, in the order the bindings are listed, and a
 * list of ids is ONE binding used as `= ANY(?)`. These builders used to emit
 * Postgres `$1..$n`, which knex's `raw` does not bind: it counts `?` and
 * throws "Expected N bindings, saw 0", so both dashboards answered 500 on
 * every call that reached SQL. Their unit spec checked the strings and the
 * bindings, never a query run (SD-74).
 */

/** One binding: a scalar, or a list for `= ANY(?)`. */
export type SqlBinding = string | number | Date | string[]

export type SqlQuery = { sql: string; bindings: SqlBinding[] }

export type DateWindow = { from: Date; to: Date }

/** Clamp a `?range=` day count to a sane window ending now. */
export function rangeToWindow(range: unknown, now: Date = new Date()): DateWindow & {
  days: number
} {
  const parsed = Math.trunc(Number(range))
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 365) : 30
  return {
    days,
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    to: now,
  }
}

/* -------------------------------------------------------------------------
 * Product funnel (vendor view) — events scoped to the seller's product ids.
 * ---------------------------------------------------------------------- */

/** Per-product view/add-to-cart counts over the window. */
export function productFunnelQuery(args: {
  productIds: string[]
  window: DateWindow
}): SqlQuery {
  const { productIds, window } = args
  return {
    sql: `
      SELECT product_id,
             COUNT(*) FILTER (WHERE event_name = 'product_view')  AS views,
             COUNT(*) FILTER (WHERE event_name = 'add_to_cart')   AS add_to_carts
        FROM analytics_event
       WHERE deleted_at IS NULL
         AND occurred_at >= ? AND occurred_at <= ?
         AND product_id = ANY(?)
         AND event_name IN ('product_view', 'add_to_cart')
       GROUP BY product_id`,
    bindings: [window.from, window.to, productIds],
  }
}

/** By-day view/add-to-cart series over the seller's products. */
export function productByDayQuery(args: {
  productIds: string[]
  window: DateWindow
}): SqlQuery {
  const { productIds, window } = args
  return {
    sql: `
      SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS date,
             COUNT(*) FILTER (WHERE event_name = 'product_view')  AS views,
             COUNT(*) FILTER (WHERE event_name = 'add_to_cart')   AS add_to_carts
        FROM analytics_event
       WHERE deleted_at IS NULL
         AND occurred_at >= ? AND occurred_at <= ?
         AND product_id = ANY(?)
         AND event_name IN ('product_view', 'add_to_cart')
       GROUP BY 1
       ORDER BY 1 ASC`,
    bindings: [window.from, window.to, productIds],
  }
}

/**
 * The order lines of placed orders, as Medusa 2 stores them: a line's
 * quantity is on `order_item` (one row per order version), not on
 * `order_line_item`, which has no `order_id`, `quantity` or `total` column.
 * Joined at the order's current version, so an edited order counts once and at
 * its latest quantity. Draft and canceled orders are not sales.
 */
export const PLACED_ORDER_LINES_SQL = `
        FROM order_item oi
        JOIN "order" o
          ON o.id = oi.order_id
         AND oi.version = o.version
        JOIN order_line_item oli ON oli.id = oi.item_id
       WHERE oi.deleted_at IS NULL
         AND oli.deleted_at IS NULL
         AND o.deleted_at IS NULL
         AND o.canceled_at IS NULL
         AND o.is_draft_order = false
         AND o.status NOT IN ('draft', 'canceled')`

/**
 * Ground-truth orders/units per product from real order lines — conversion is
 * orders-per-view, not event-claimed.
 */
export function productOrdersQuery(args: {
  productIds: string[]
  window: DateWindow
}): SqlQuery {
  const { productIds, window } = args
  return {
    sql: `
      SELECT oli.product_id,
             COUNT(DISTINCT o.id)             AS orders,
             COALESCE(SUM(oi.quantity), 0)    AS units,
             MAX(oli.title)                   AS title
        ${PLACED_ORDER_LINES_SQL}
         AND o.created_at >= ? AND o.created_at <= ?
         AND oli.product_id = ANY(?)
       GROUP BY oli.product_id`,
    bindings: [window.from, window.to, productIds],
  }
}

export type ProductFunnelRow = {
  product_id: string
  title: string | null
  views: number
  add_to_carts: number
  orders: number
  units: number
  /** orders / views, 4-decimal fraction; null when there are no views. */
  conversion: number | null
}

/**
 * Merge the event counts and order counts into per-product funnel rows,
 * sorted by views desc. Products with zero activity are dropped.
 */
export function mergeProductFunnel(
  eventRows: Array<Record<string, unknown>>,
  orderRows: Array<Record<string, unknown>>
): ProductFunnelRow[] {
  const byProduct = new Map<string, ProductFunnelRow>()

  const ensure = (productId: string): ProductFunnelRow => {
    let row = byProduct.get(productId)
    if (!row) {
      row = {
        product_id: productId,
        title: null,
        views: 0,
        add_to_carts: 0,
        orders: 0,
        units: 0,
        conversion: null,
      }
      byProduct.set(productId, row)
    }
    return row
  }

  for (const r of eventRows) {
    const id = String(r.product_id ?? "")
    if (!id) continue
    const row = ensure(id)
    row.views = Number(r.views) || 0
    row.add_to_carts = Number(r.add_to_carts) || 0
  }
  for (const r of orderRows) {
    const id = String(r.product_id ?? "")
    if (!id) continue
    const row = ensure(id)
    row.orders = Number(r.orders) || 0
    row.units = Number(r.units) || 0
    row.title = typeof r.title === "string" ? r.title : row.title
  }

  const rows = [...byProduct.values()]
  for (const row of rows) {
    row.conversion =
      row.views > 0 ? Math.round((row.orders / row.views) * 10000) / 10000 : null
  }
  return rows.sort((a, b) => b.views - a.views)
}

/* -------------------------------------------------------------------------
 * Creator performance — events scoped by creator_seller_id, conversions
 * from order_attribution (the money-side source of truth).
 * ---------------------------------------------------------------------- */

const CREATOR_EVENTS = [
  "creator_profile_view",
  "creator_link_clicked",
  "click_affiliate",
] as const

/** Total per-event counts for the creator over the window. */
export function creatorTotalsQuery(args: {
  creatorSellerId: string
  window: DateWindow
}): SqlQuery {
  return {
    sql: `
      SELECT event_name, COUNT(*) AS count
        FROM analytics_event
       WHERE deleted_at IS NULL
         AND occurred_at >= ? AND occurred_at <= ?
         AND creator_seller_id = ?
         AND event_name IN ('${CREATOR_EVENTS.join("', '")}')
       GROUP BY event_name`,
    bindings: [args.window.from, args.window.to, args.creatorSellerId],
  }
}

/** By-day creator event series. */
export function creatorByDayQuery(args: {
  creatorSellerId: string
  window: DateWindow
}): SqlQuery {
  return {
    sql: `
      SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS date,
             COUNT(*) FILTER (WHERE event_name = 'creator_profile_view') AS profile_views,
             COUNT(*) FILTER (WHERE event_name IN ('creator_link_clicked', 'click_affiliate')) AS link_clicks
        FROM analytics_event
       WHERE deleted_at IS NULL
         AND occurred_at >= ? AND occurred_at <= ?
         AND creator_seller_id = ?
         AND event_name IN ('${CREATOR_EVENTS.join("', '")}')
       GROUP BY 1
       ORDER BY 1 ASC`,
    bindings: [args.window.from, args.window.to, args.creatorSellerId],
  }
}

/** Campaign breakdown of the creator's events. */
export function creatorByCampaignQuery(args: {
  creatorSellerId: string
  window: DateWindow
}): SqlQuery {
  return {
    sql: `
      SELECT COALESCE(utm_campaign, '(none)') AS campaign,
             COUNT(*) AS events,
             COUNT(*) FILTER (WHERE event_name IN ('creator_link_clicked', 'click_affiliate')) AS link_clicks
        FROM analytics_event
       WHERE deleted_at IS NULL
         AND occurred_at >= ? AND occurred_at <= ?
         AND creator_seller_id = ?
         AND event_name IN ('${CREATOR_EVENTS.join("', '")}')
       GROUP BY 1
       ORDER BY events DESC
       LIMIT 25`,
    bindings: [args.window.from, args.window.to, args.creatorSellerId],
  }
}

/** Attributed conversions + commission from order_attribution. */
export function creatorAttributionQuery(args: {
  creatorSellerId: string
  window: DateWindow
}): SqlQuery {
  return {
    sql: `
      SELECT COUNT(*)                                    AS attributed_orders,
             COALESCE(SUM(commission_amount_cents), 0)   AS commission_cents
        FROM order_attribution
       WHERE deleted_at IS NULL
         AND created_at >= ? AND created_at <= ?
         AND creator_seller_id = ?
         AND commission_status NOT IN ('reversed', 'disqualified')`,
    bindings: [args.window.from, args.window.to, args.creatorSellerId],
  }
}

export type CreatorTotals = {
  profile_views: number
  link_clicks: number
  affiliate_clicks: number
  attributed_orders: number
  commission_cents: number
}

/** Fold the totals + attribution rows into the response DTO. */
export function mapCreatorTotals(
  eventRows: Array<Record<string, unknown>>,
  attributionRows: Array<Record<string, unknown>>
): CreatorTotals {
  const byEvent = new Map(
    eventRows.map((r) => [String(r.event_name), Number(r.count) || 0])
  )
  const attribution = attributionRows[0] ?? {}
  return {
    profile_views: byEvent.get("creator_profile_view") ?? 0,
    link_clicks: byEvent.get("creator_link_clicked") ?? 0,
    affiliate_clicks: byEvent.get("click_affiliate") ?? 0,
    attributed_orders: Number(attribution.attributed_orders) || 0,
    commission_cents: Number(attribution.commission_cents) || 0,
  }
}
