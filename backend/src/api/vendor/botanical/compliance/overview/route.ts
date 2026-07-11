import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BOTANICAL_MODULE } from "../../../../../modules/botanical"
import type BotanicalModuleService from "../../../../../modules/botanical/service"
import { getSellerId } from "../../../quests/_helpers"

/** Frameworks with no consumer-labeling regime → "none_required". */
const NO_FRAMEWORK = new Set(["craft_supply", "self_regulated"])

/**
 * GET /vendor/botanical/compliance/overview
 * Compliance center view model: per-pathway status rows, cottage-food
 * tracking, and the raw pH / germination logs. Status derivation:
 *   - none_required — craft/self-regulated frameworks
 *   - attention     — pathway requires pH testing but has no passing log yet,
 *                     or any germination lot is alerting
 *   - ok            — otherwise
 *
 * Cottage-food YTD revenue is owned by the order/ledger side and not yet
 * aggregated here — reported as 0 (with the cap unset) rather than fabricated;
 * the portal hides the meter when cap_cents is 0.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const makerId = getSellerId(req)
  if (!makerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<BotanicalModuleService>(BOTANICAL_MODULE)
  const [pathways, phLogs, germinationLogs] = await Promise.all([
    service.listActivePathwaysForMaker(makerId),
    service.listPhLogsForMaker(makerId),
    service.listGerminationLogsForMaker(makerId),
  ])

  const passingPhPathways = new Set(
    phLogs.filter((l) => l.pass).map((l) => l.pathway_id)
  )
  const germinationAlerts = germinationLogs.some((l) => l.alert)

  const pathway_rows = pathways.map((p) => {
    if (NO_FRAMEWORK.has(p.compliance_framework_id)) {
      return {
        pathway_id: p.id,
        pathway_name: p.name,
        output_category: p.output_category,
        framework_id: p.compliance_framework_id,
        status: "none_required" as const,
        note: "No regulatory framework applies to this pathway.",
      }
    }

    const needsPh = p.requires_ph_testing && !passingPhPathways.has(p.id)
    const seedAlert = p.output_category === "seed_packet" && germinationAlerts
    const attention = needsPh || seedAlert

    return {
      pathway_id: p.id,
      pathway_name: p.name,
      output_category: p.output_category,
      framework_id: p.compliance_framework_id,
      status: attention ? ("attention" as const) : ("ok" as const),
      note: needsPh
        ? "pH testing required — no passing pH log recorded yet."
        : seedAlert
          ? "A seed lot has a low or stale germination test."
          : "No outstanding compliance actions.",
    }
  })

  res.json({
    pathway_rows,
    cottage_food: {
      enabled: pathways.some((p) => p.counts_toward_cottage_food_limit),
      state: "",
      ytd_revenue_cents: 0,
      cap_cents: 0,
    },
    ph_logs: phLogs,
    germination_logs: germinationLogs,
  })
}
