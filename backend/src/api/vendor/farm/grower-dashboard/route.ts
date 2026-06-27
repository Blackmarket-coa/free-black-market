import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GrowerPayoutService } from "../../../../modules/payout-breakdown/grower-payout"
import { GrowerKarmaService } from "../../../../modules/progression/grower-karma"

/**
 * Plant Network — Grower-node dashboard (Section 8).
 *
 * GET /vendor/farm/grower-dashboard
 *
 * Seller-scoped: the grower id comes from the vendor auth context (same pattern
 * as `api/vendor/farm/stats/route.ts`). Returns ONLY the calling grower's data:
 * KARMA tier, ledger earnings summary, pending balance, and a best-effort
 * units/top-SKU breakdown from the seller's recent orders.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (
    req as unknown as { auth_context?: { actor_id: string } }
  ).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const container = req.scope
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (a: Record<string, unknown>) => Promise<{ data: any[] }>
  }

  const now = new Date()
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const payoutService = new GrowerPayoutService(container)
  const karmaService = new GrowerKarmaService(container)

  // KARMA tier (real).
  const tier = await karmaService.getGrowerTier(sellerId).catch(() => null)

  // Ledger earnings history (real).
  type PayoutHistory = Awaited<ReturnType<GrowerPayoutService["getGrowerPayoutHistory"]>>
  const history: PayoutHistory = await payoutService
    .getGrowerPayoutHistory(sellerId, sixMonthsAgo, now)
    .catch((): PayoutHistory => [])

  const paidToDate = history
    .filter((h) => h.direction === "credit")
    .reduce((s, h) => s + h.amount, 0)
  const hubCuts = history
    .filter((h) => h.direction === "debit")
    .reduce((s, h) => s + h.amount, 0)

  // Monthly earnings buckets (YYYY-MM → net dollars).
  const monthly = new Map<string, number>()
  for (const h of history) {
    const key = h.created_at.toISOString().slice(0, 7)
    const signed = h.direction === "credit" ? h.amount : -h.amount
    monthly.set(key, (monthly.get(key) ?? 0) + signed)
  }
  const payoutHistory = Array.from(monthly.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 }))

  // Best-effort units sold + top SKUs from the seller's products and orders.
  let unitsSold = 0
  let grossRevenueCents = 0
  let topSkus: Array<{ product_id: string; units: number; revenue_cents: number }> = []
  let unitsSource: "orders" | "unavailable" = "unavailable"
  try {
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "products.id"],
      filters: { id: sellerId },
    })
    const productIds: string[] = (sellers?.[0]?.products ?? [])
      .map((p: { id?: string }) => p?.id)
      .filter((x: string | undefined): x is string => !!x)

    if (productIds.length > 0) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "items.product_id", "items.quantity", "items.unit_price"],
        filters: { items: { product_id: productIds } },
      })
      const perProduct = new Map<string, { units: number; revenue: number }>()
      for (const order of orders ?? []) {
        for (const it of order.items ?? []) {
          if (!it.product_id || !productIds.includes(it.product_id)) continue
          const qty = Number(it.quantity ?? 0)
          const rev = Number(it.unit_price ?? 0) * qty
          unitsSold += qty
          grossRevenueCents += rev
          const agg = perProduct.get(it.product_id) ?? { units: 0, revenue: 0 }
          agg.units += qty
          agg.revenue += rev
          perProduct.set(it.product_id, agg)
        }
      }
      topSkus = Array.from(perProduct.entries())
        .map(([product_id, v]) => ({ product_id, units: v.units, revenue_cents: v.revenue }))
        .sort((a, b) => b.revenue_cents - a.revenue_cents)
        .slice(0, 5)
      unitsSource = "orders"
    }
  } catch {
    // best-effort; leave defaults + unitsSource "unavailable"
  }

  return res.json({
    grower: { seller_id: sellerId },
    karma: tier,
    earnings: {
      currency: "USD",
      paid_to_date: Math.round(paidToDate * 100) / 100,
      hub_cuts: Math.round(hubCuts * 100) / 100,
      net_6mo: Math.round((paidToDate - hubCuts) * 100) / 100,
      payout_history: payoutHistory,
    },
    sales: {
      units_sold: unitsSold,
      gross_revenue_cents: grossRevenueCents,
      top_skus: topSkus,
      source: unitsSource,
    },
    period: { from: sixMonthsAgo.toISOString(), to: now.toISOString() },
  })
}
