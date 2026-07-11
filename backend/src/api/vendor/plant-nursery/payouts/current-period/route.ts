import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getSellerId } from "../../../quests/_helpers"
import { GrowerKarmaService } from "../../../../../modules/progression/grower-karma"
import { PROGRESSION_MODULE } from "../../../../../modules/progression"
import { Stance } from "../../../../../modules/progression/stance"
import {
  getSellerLedgerEntries,
  purchaseRevenueCents,
  startOfMonth,
  startOfYear,
} from "../../../../../shared/vendor-earnings"
import { getSellerOrders } from "../../../../../shared/seller-orders"

/** IRS 1099-K/-NEC reporting becomes relevant at $600 gross for the year. */
const W9_THRESHOLD_CENTS = 600 * 100

/** Humanize a karma reason slug: "grower:on_time_delivery" → "On time delivery". */
function describeReason(reason: string): string {
  const slug = reason.replace(/^grower:/, "").replace(/[-_]/g, " ")
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/**
 * GET /vendor/plant-nursery/payouts/current-period
 * The vendor's payouts view model, aggregated from the systems that own each
 * fact:
 *   - money    — hawala-ledger SELLER_EARNINGS entries (PURCHASE credits =
 *                gross revenue; WITHDRAWAL/PAYOUT debits mark paid months)
 *   - karma    — progression PRODUCER-track XP via GrowerKarmaService (tier,
 *                split %, and the event feed)
 *   - units    — the seller's marketplace orders (items restricted to the
 *                seller's own products)
 * A vendor with no sales/karma history gets the honest seedling baseline.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const karmaService = new GrowerKarmaService(req.scope)

  const [entries, orders, tier] = await Promise.all([
    getSellerLedgerEntries(req.scope, sellerId),
    getSellerOrders(req.scope, sellerId),
    karmaService.getGrowerTier(sellerId).catch(() => null),
  ])

  // Karma event feed: the grower's PRODUCER-track XP events.
  let karma_events: {
    id: string
    type: string
    karma: number
    at: string
    description: string
  }[] = []
  try {
    const customerId = await karmaService.resolveGrowerCustomerId(sellerId)
    if (customerId) {
      const progression = req.scope.resolve<{
        listXpEvents(
          filters: Record<string, unknown>,
          config?: Record<string, unknown>
        ): Promise<
          {
            id: string
            reason?: string | null
            amount?: number | null
            occurred_at?: string | Date | null
            created_at?: string | Date | null
          }[]
        >
      }>(PROGRESSION_MODULE)
      const events = await progression.listXpEvents(
        { customer_id: customerId, role: Stance.PRODUCER },
        { order: { occurred_at: "DESC" }, take: 20 }
      )
      karma_events = events.map((e) => ({
        id: e.id,
        type: String(e.reason ?? "").replace(/^grower:/, ""),
        karma: Number(e.amount ?? 0),
        at: new Date(e.occurred_at ?? e.created_at ?? 0).toISOString(),
        description: describeReason(String(e.reason ?? "")),
      }))
    }
  } catch {
    karma_events = []
  }

  const now = new Date()
  const monthStart = startOfMonth(now)
  const splitPct = tier ? Math.round(tier.current_split_pct * 100) : 60

  // Current calendar-month figures.
  const grossCents = purchaseRevenueCents(entries, monthStart)
  const monthOrders = orders.filter((o) => new Date(o.created_at) >= monthStart)
  const unitsSold = monthOrders.reduce(
    (s, o) => s + o.items.reduce((si, it) => si + it.quantity, 0),
    0
  )

  // Per-product split breakdown for the current month.
  const perProduct = new Map<string, { units: number; gross: number }>()
  for (const o of monthOrders) {
    for (const it of o.items) {
      const agg = perProduct.get(it.title) ?? { units: 0, gross: 0 }
      agg.units += it.quantity
      agg.gross += it.unit_price * it.quantity
      perProduct.set(it.title, agg)
    }
  }
  const split_breakdown = Array.from(perProduct.entries())
    .map(([product_name, v]) => ({
      product_name,
      units: v.units,
      gross_cents: v.gross,
      your_cut_cents: Math.round((v.gross * splitPct) / 100),
    }))
    .sort((a, b) => b.gross_cents - a.gross_cents)
    .slice(0, 10)

  // Monthly history: bucket ledger sales by calendar month (up to 12 back);
  // a WITHDRAWAL/PAYOUT debit inside a month marks it paid.
  const history: {
    id: string
    month: string
    units_sold: number
    gross_cents: number
    split_pct: number
    net_cents: number
    paid_at: string | null
    transfer_ref: string | null
  }[] = []
  for (let back = 1; back <= 12; back++) {
    const from = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - back + 1, 1)
    const gross = purchaseRevenueCents(entries, from, to)
    if (gross === 0) continue
    const monthKey = from.toISOString().slice(0, 7)
    const payout = entries.find((e) => {
      const at = new Date(e.created_at).getTime()
      return (
        e.direction === "DEBIT" &&
        ["WITHDRAWAL", "PAYOUT"].includes(e.entry_type) &&
        at >= from.getTime() &&
        at < to.getTime() + 35 * 24 * 60 * 60 * 1000
      )
    })
    const units = orders
      .filter((o) => {
        const at = new Date(o.created_at).getTime()
        return at >= from.getTime() && at < to.getTime()
      })
      .reduce((s, o) => s + o.items.reduce((si, it) => si + it.quantity, 0), 0)
    history.push({
      id: `payout_${monthKey}`,
      month: monthKey,
      units_sold: units,
      gross_cents: gross,
      split_pct: splitPct,
      net_cents: Math.round((gross * splitPct) / 100),
      paid_at: payout ? new Date(payout.created_at).toISOString().slice(0, 10) : null,
      transfer_ref: payout ? payout.id : null,
    })
  }

  // YTD from the ledger; earnings are what actually reached the seller's
  // account, so YTD gross also drives the W-9 nudge.
  const ytdGrossCents = purchaseRevenueCents(entries, startOfYear(now))
  const earnings_ytd_cents = Math.round((ytdGrossCents * splitPct) / 100)

  const next = new Date(now.getFullYear(), now.getMonth() + 1, 5)

  res.json({
    current_period: {
      units_sold: unitsSold,
      gross_cents: grossCents,
      split_pct: splitPct,
      net_cents: Math.round((grossCents * splitPct) / 100),
      next_payment_date: next.toISOString().slice(0, 10),
    },
    tier: tier ? tier.tier.toLowerCase() : "seedling",
    karma_total: tier?.current_karma ?? 0,
    karma_events,
    history,
    split_breakdown,
    earnings_ytd_cents,
    w9_required: ytdGrossCents >= W9_THRESHOLD_CENTS,
  })
}
