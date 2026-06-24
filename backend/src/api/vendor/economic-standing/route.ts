import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/economic-standing")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../modules/hawala-ledger/service"

/**
 * GET /vendor/economic-standing
 *
 * FBM-internal, vendor-authenticated view of the seller's economic standing
 * (Coalition Credits balance, payout summary, current-period sales, creator
 * rewards eligibility). Reuses `hawala.getEconomicStandingByMxid` and mirrors
 * the response shape of the Blackout OAuth route
 * (`/v1/integrations/blackout/entitlements/economic-standing`) so both stay in
 * sync.
 *
 * Graceful: a seller without a provisioned mxid (not yet backfilled) returns a
 * zeroed payload with HTTP 200 rather than a 404.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
  }

  try {
    const sellerLookup = await pgConnection.raw(
      `SELECT mxid FROM seller_metadata WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sellerId]
    )
    const mxid = sellerLookup?.rows?.[0]?.mxid

    if (typeof mxid !== "string" || !mxid) {
      res.json(zeroedStanding(null))
      return
    }

    const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
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
  } catch (error) {
    log.error("[GET /vendor/economic-standing] Error:", error.message)
    res.json(zeroedStanding(null))
  }
}

function zeroedStanding(mxid: string | null) {
  return {
    mxid,
    coalition_credits: {
      available: 0,
      pending: 0,
      currency: "USD",
      last_settlement_at: null,
    },
    payouts: { pending_amount: 0, currency: "USD", next_payout_at: null },
    vendor_sales: {
      period: measurementPeriodLabel(new Date()),
      gross_volume: 0,
      net_volume: 0,
      currency: "USD",
    },
    creator_rewards: { eligible: false, program_keys: [] as string[] },
    evaluated_at: new Date().toISOString(),
  }
}

function measurementPeriodLabel(d: Date): string {
  const year = d.getUTCFullYear()
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1
  return `${year}-Q${quarter}`
}
