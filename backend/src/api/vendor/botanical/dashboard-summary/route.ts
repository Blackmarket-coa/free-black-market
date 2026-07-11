import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../modules/botanical"
import type BotanicalModuleService from "../../../../modules/botanical/service"
import { getSellerId } from "../../quests/_helpers"
import {
  getSellerLedgerEntries,
  purchaseRevenueCents,
  startOfMonth,
} from "../../../../shared/vendor-earnings"
import { getSellerQuestHighlights } from "../../../../shared/seller-quests"

const ACTIVE_RUN_STATUSES = ["in_progress", "curing", "testing"]
const QUEUE_STATUSES = ["planned", "in_progress", "curing", "testing", "quarantine"]

/**
 * GET /vendor/botanical/dashboard-summary
 * The maker dashboard "today's pulse". Aggregates the systems that own each
 * fact: pathways/runs/formulas/materials/goods (this module), month earnings
 * (hawala ledger), and quest progress (vendor-quest).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const [pathways, formulas, runs, materials, goods, ledgerEntries, questHighlights] =
    await Promise.all([
      service.listActivePathwaysForMaker(makerId),
      service.listFormulasForMaker(makerId),
      service.listRunsForMaker(makerId),
      service.listMaterialsForMaker(makerId),
      service.listFinishedGoodsForMaker(makerId),
      getSellerLedgerEntries(req.scope, makerId),
      getSellerQuestHighlights(req.scope, makerId),
    ])

  // Pathway cards carry denormalized counts.
  const formulaCounts = new Map<string, number>()
  for (const f of formulas) {
    formulaCounts.set(f.pathway_id, (formulaCounts.get(f.pathway_id) ?? 0) + 1)
  }
  const runCounts = new Map<string, number>()
  for (const r of runs) {
    if (r.status === "complete" || r.status === "failed") continue
    runCounts.set(r.pathway_id, (runCounts.get(r.pathway_id) ?? 0) + 1)
  }
  const active_pathways = pathways.map((p) => ({
    ...p,
    formula_count: formulaCounts.get(p.id) ?? 0,
    active_run_count: runCounts.get(p.id) ?? 0,
  }))

  // Inventory alerts: raw materials at/below their reorder threshold, plus
  // finished goods expiring within 30 days.
  const now = Date.now()
  const soon = now + 30 * 24 * 60 * 60 * 1000
  const inventory_alerts: {
    id: string
    label: string
    detail: string
    severity: "high" | "med" | "low"
  }[] = []
  for (const m of materials) {
    if (m.reorder_threshold > 0 && m.current_stock <= m.reorder_threshold) {
      inventory_alerts.push({
        id: m.id,
        label: m.name,
        detail: `${m.current_stock} ${m.stock_unit} left (reorder at ${m.reorder_threshold})`,
        severity: m.current_stock <= 0 ? "high" : "med",
      })
    }
  }
  for (const g of goods) {
    const expiry = g.expiry_date ? new Date(g.expiry_date).getTime() : null
    if (expiry !== null && expiry <= soon && g.quantity_on_hand > 0) {
      inventory_alerts.push({
        id: g.id,
        label: g.product_name,
        detail:
          expiry <= now
            ? `Batch ${g.batch_number} has expired`
            : `Batch ${g.batch_number} expires ${new Date(expiry).toISOString().slice(0, 10)}`,
        severity: expiry <= now ? "high" : "low",
      })
    }
  }

  const urgent_actions: { type: string; message: string; link: string }[] = []
  const quarantined = runs.filter((r) => r.status === "quarantine").length
  if (quarantined > 0) {
    urgent_actions.push({
      type: "compliance",
      message: `${quarantined} production run${quarantined === 1 ? "" : "s"} in quarantine`,
      link: "/production",
    })
  }
  const outOfStock = inventory_alerts.filter((a) => a.severity === "high").length
  if (outOfStock > 0) {
    urgent_actions.push({
      type: "inventory",
      message: `${outOfStock} item${outOfStock === 1 ? "" : "s"} out of stock or expired`,
      link: "/raw-materials",
    })
  }

  // Portfolio-wide BMC-sourced % across formula ingredients.
  let ingredientTotal = 0
  let ingredientBmc = 0
  for (const f of formulas) {
    const ingredients = Array.isArray(f.ingredients) ? f.ingredients : []
    for (const ing of ingredients as { bmc_sourced?: boolean }[]) {
      ingredientTotal++
      if (ing?.bmc_sourced) ingredientBmc++
    }
  }
  const bmc_sourced_pct =
    ingredientTotal > 0 ? Math.round((ingredientBmc / ingredientTotal) * 100) : 0

  res.json({
    active_pathways,
    urgent_actions,
    todays_metrics: {
      active_runs: runs.filter((r) => ACTIVE_RUN_STATUSES.includes(r.status)).length,
      finished_units_on_hand: goods
        .filter((g) => g.status === "available")
        .reduce((s, g) => s + g.quantity_on_hand, 0),
      active_formulas: formulas.filter((f) => f.status === "approved").length,
      month_earnings_cents: purchaseRevenueCents(ledgerEntries, startOfMonth()),
    },
    production_queue: runs.filter((r) => QUEUE_STATUSES.includes(r.status)),
    inventory_alerts,
    bmc_sourced_pct,
    quest_highlights: questHighlights,
  })
}
