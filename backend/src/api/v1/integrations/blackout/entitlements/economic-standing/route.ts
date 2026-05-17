import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  isBlackoutIntegrationEnabled,
  verifyBlackoutToken,
} from "../../../../../../lib/blackout-oauth"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * Economic-standing endpoint per `docs/contracts/entitlements.yaml` §2.5.
 *
 * Returns the EconomicStanding shape: Coalition Credits balance (sum of
 * available + pending across the MXID's wallet/earnings accounts), payout
 * summary with the next payout window, vendor sales summary for the
 * current measurement period, and creator-rewards eligibility flags.
 *
 * Resolution path: MXID → seller_metadata.mxid (workstream 1) and/or
 * customer.metadata.mxid → ledger accounts. Empty totals are a valid
 * response, not a 404 — a fresh MXID with no transactions is expected
 * during foundation milestone.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) {
    return res
      .status(503)
      .json({ code: "service_disabled", message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
  }

  const header = req.headers.authorization
  const token = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null
  if (!token || !verifyBlackoutToken(token)) {
    return res.status(401).json({ code: "unauthorized", message: "Invalid or missing Bearer token" })
  }

  const mxid = String(req.query.mxid || "").trim()
  if (!mxid) {
    return res.status(400).json({ code: "bad_request", message: "mxid is required" })
  }

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
  }

  const standing = await hawala.getEconomicStandingByMxid({ mxid, pgConnection })

  const sellerEarningsSources = standing.sources.filter(
    (s) => s.account_type === "SELLER_EARNINGS"
  )
  const creatorEarningsSources = standing.sources.filter(
    (s) => s.account_type === "CREATOR_EARNINGS"
  )
  const grossSellerVolume = sellerEarningsSources.reduce(
    (sum, s) => sum + s.available + s.pending,
    0
  )

  res.json({
    mxid,
    coalition_credits: {
      available: Math.round(standing.available),
      pending: Math.round(standing.pending),
      currency: standing.currency,
      last_settlement_at: standing.last_settlement_at,
    },
    payouts: {
      pending_amount: Math.round(
        sellerEarningsSources.reduce((sum, s) => sum + s.pending, 0)
      ),
      currency: standing.currency,
      next_payout_at: null,
    },
    vendor_sales: {
      period: measurementPeriodLabel(new Date()),
      gross_volume: Math.round(grossSellerVolume),
      net_volume: Math.round(
        sellerEarningsSources.reduce((sum, s) => sum + s.available, 0)
      ),
      currency: standing.currency,
    },
    creator_rewards: {
      eligible: creatorEarningsSources.length > 0,
      program_keys: creatorEarningsSources.length > 0 ? ["creator-rewards"] : [],
    },
    evaluated_at: new Date().toISOString(),
  })
}

function measurementPeriodLabel(d: Date): string {
  const year = d.getUTCFullYear()
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1
  return `${year}-Q${quarter}`
}
