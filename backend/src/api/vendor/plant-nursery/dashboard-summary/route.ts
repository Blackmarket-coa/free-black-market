import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../quests/_helpers"

const IN_PROPAGATION_STATUSES = ["started", "germinating", "rooting", "growing_out"]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /vendor/plant-nursery/dashboard-summary
 * The vendor dashboard "today's pulse". Aggregates real data this vertical
 * owns (propagation batches, stratification, DOA claims). Surfaces owned by
 * other systems — marketplace orders/listings/earnings (order + ledger side),
 * Blackout room previews, and quest highlights — are reported as zero/empty
 * rather than fabricated, matching the creator hub-data convention; the
 * portal renders those sections empty until the cross-module aggregations
 * are wired in.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const [batches, stratification, doaClaims] = await Promise.all([
    service.listBatchesForSeller(sellerId),
    service.listStratificationForSeller(sellerId),
    service.listDoaClaimsForSeller(sellerId),
  ])

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

  res.json({
    urgent_actions,
    todays_metrics: {
      orders_pending: 0,
      units_in_propagation: inPropagation.reduce((s, b) => s + b.qty_started, 0),
      active_listings: 0,
      month_earnings_cents: 0,
    },
    propagation_batches: inPropagation.slice(0, 8),
    recent_orders: [],
    seasonal_alerts,
    blackout_preview: [],
    quest_highlights: [],
  })
}
