import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { featureFlagState } from "../../../../shared/feature-flags"

/**
 * GET /admin/hawala/summary
 * Get ledger summary and statistics
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  try {
    const summary = await hawalaService.getLedgerSummary()

    // Get recent entries
    const recentEntries = await hawalaService.listLedgerEntries({
      take: 10,
    })

    // Get investment pool stats
    const pools = await hawalaService.listInvestmentPools({})
    const totalInvested = pools.reduce((sum, p) => sum + Number(p.total_raised), 0)
    const totalDistributed = pools.reduce((sum, p) => sum + Number(p.total_distributed), 0)

    // Get settlement stats
    const settlements = await hawalaService.listSettlementBatches({})
    const completedSettlements = settlements.filter(s => s.status === "CONFIRMED" || s.status === "COMPLETED")
    const totalSettledVolume = completedSettlements.reduce(
      (sum, s) => sum + Number(s.total_volume),
      0
    )

    // Designated legacy pool funds (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8):
    // how many uncarried pools still hold legacy ledger money and how much,
    // so an operator can wind them down. Present ONLY with
    // FF_NONPROFIT_PARITY_V1 on — with it off the key is absent and the
    // response is exactly what it was. The per-pool lines are at
    // GET /admin/hawala/pools/designated.
    const designated = featureFlagState.isEnabled("NONPROFIT_PARITY_V1")
      ? await hawalaService.listDesignatedPoolFunds()
      : null

    res.json({
      accounts: summary,
      investments: {
        total_pools: pools.length,
        total_invested: totalInvested,
        total_distributed: totalDistributed,
      },
      ...(designated
        ? { designated_pool_funds: { pools: designated.totals.pools, total: designated.totals.account_balance } }
        : {}),
      settlements: {
        total_batches: settlements.length,
        completed_batches: completedSettlements.length,
        total_settled_volume: totalSettledVolume,
      },
      recent_entries: recentEntries,
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
