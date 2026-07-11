import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { NURSERY_VERTICAL_MODULE } from "../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../quests/_helpers"
import {
  getSellerLedgerEntries,
  purchaseRevenueCents,
  startOfMonth,
} from "../../../../shared/vendor-earnings"
import {
  getSellerOrders,
  isPendingFulfillment,
  type SellerOrder,
} from "../../../../shared/seller-orders"
import { getSellerQuestHighlights } from "../../../../shared/seller-quests"

const IN_PROPAGATION_STATUSES = ["started", "germinating", "rooting", "growing_out"]

const DAY_MS = 24 * 60 * 60 * 1000
/** Standard fulfillment SLA used for ship-by until per-order SLAs exist. */
const SHIP_BY_SLA_DAYS = 3

/** Map a Medusa fulfillment_status onto the portal's order status vocabulary. */
function toPortalOrderStatus(
  status: string | null | undefined
): "unfulfilled" | "packed" | "shipped" {
  if (!status || status === "not_fulfilled" || status === "partially_fulfilled") {
    return "unfulfilled"
  }
  if (["shipped", "partially_shipped", "delivered", "partially_delivered"].includes(status)) {
    return "shipped"
  }
  return "packed" // fulfilled but not yet shipped
}

function toNurseryOrder(o: SellerOrder) {
  const createdAt = new Date(o.created_at)
  return {
    id: o.id,
    buyer_name: o.buyer_name,
    lines: o.items.map((it) => ({ species_name: it.title, qty: it.quantity })),
    destination_state: o.destination_state,
    ship_by: new Date(createdAt.getTime() + SHIP_BY_SLA_DAYS * DAY_MS).toISOString(),
    status: toPortalOrderStatus(o.fulfillment_status),
    total_cents: o.seller_total_cents,
    created_at: createdAt.toISOString(),
  }
}

/**
 * GET /vendor/plant-nursery/dashboard-summary
 * The vendor dashboard "today's pulse". Aggregates the systems that own each
 * fact: propagation/stratification/DOA (this vertical), orders + listings
 * (marketplace, best-effort), month earnings (hawala ledger), and quest
 * progress (vendor-quest). Blackout room previews remain empty — the rooms
 * live in the Blackout repo and are not fabricated here.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const [batches, stratification, doaClaims, orders, ledgerEntries, questHighlights] =
    await Promise.all([
      service.listBatchesForSeller(sellerId),
      service.listStratificationForSeller(sellerId),
      service.listDoaClaimsForSeller(sellerId),
      getSellerOrders(req.scope, sellerId),
      getSellerLedgerEntries(req.scope, sellerId),
      getSellerQuestHighlights(req.scope, sellerId),
    ])

  // Published listings count (seller_product link → product status).
  let activeListings = 0
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as {
      graph: (a: Record<string, unknown>) => Promise<{
        data: { product?: { id?: string; status?: string } | null }[]
      }>
    }
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["product.id", "product.status"],
      filters: { seller_id: sellerId },
    })
    activeListings = (sellerProducts ?? []).filter(
      (sp) => sp?.product?.status === "published"
    ).length
  } catch {
    activeListings = 0
  }

  const now = Date.now()
  const urgent_actions: {
    type: "orders" | "inventory" | "seasonal" | "quest" | "compliance"
    message: string
    count?: number
    link: string
  }[] = []

  // Ready batches not yet listed → stock sitting unsold.
  const readyUnlisted = batches.filter((b) => b.status === "ready").length
  if (readyUnlisted > 0) {
    urgent_actions.push({
      type: "inventory",
      message: `${readyUnlisted} batch${readyUnlisted === 1 ? "" : "es"} ready but not listed`,
      count: readyUnlisted,
      link: "/inventory",
    })
  }

  // Open DOA claims need a reship/refund decision.
  const openClaims = doaClaims.filter((c) => c.status === "open").length
  if (openClaims > 0) {
    urgent_actions.push({
      type: "orders",
      message: `${openClaims} open DOA claim${openClaims === 1 ? "" : "s"}`,
      count: openClaims,
      link: "/orders",
    })
  }

  // Unshipped orders.
  const pendingOrders = orders.filter((o) =>
    isPendingFulfillment(o.fulfillment_status)
  )
  if (pendingOrders.length > 0) {
    urgent_actions.push({
      type: "orders",
      message: `${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"} awaiting fulfillment`,
      count: pendingOrders.length,
      link: "/orders",
    })
  }

  // Stratification cycles ending within 7 days → time to sow.
  const endingSoon = stratification.filter((s) => {
    const end = new Date(s.end_at).getTime()
    return end >= now && end <= now + 7 * DAY_MS
  })
  if (endingSoon.length > 0) {
    urgent_actions.push({
      type: "seasonal",
      message: `${endingSoon.length} stratification cycle${endingSoon.length === 1 ? "" : "s"} ending this week`,
      count: endingSoon.length,
      link: "/propagation",
    })
  }

  const seasonal_alerts = endingSoon.map((s) => ({
    action: `Sow ${s.species_name} (stratification complete)`,
    species: s.species_name,
    urgency: "high" as const,
  }))

  const inPropagation = batches.filter((b) =>
    IN_PROPAGATION_STATUSES.includes(b.status)
  )

  const recentOrders = [...orders]
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 5)
    .map(toNurseryOrder)

  res.json({
    urgent_actions,
    todays_metrics: {
      orders_pending: pendingOrders.length,
      units_in_propagation: inPropagation.reduce((s, b) => s + b.qty_started, 0),
      active_listings: activeListings,
      month_earnings_cents: purchaseRevenueCents(ledgerEntries, startOfMonth()),
    },
    propagation_batches: inPropagation.slice(0, 8),
    recent_orders: recentOrders,
    seasonal_alerts,
    blackout_preview: [],
    quest_highlights: questHighlights,
  })
}
