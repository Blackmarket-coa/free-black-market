import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { carrierFeatureDisabled, sendCarrierError } from "../carrier-shared"

/**
 * GET /admin/hawala/pools/designated — the designated legacy pool funds
 * report (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8; legal checkpoints L26,
 * L3 — surfaced, not resolved).
 *
 * With FF_NONPROFIT_PARITY_V1 on, ledger dollars already inside an UNCARRIED
 * pool stay in that pool's own PRODUCER_POOL account, now a DESIGNATED
 * account: outbound-only back to the contributors. This lists every such pool
 * — stamped (`legacy_funds_designated_at`) or still holding a positive
 * balance — with the account balance, the sum of its outstanding
 * LEDGER-settled investments, how many of those
 * `POST /admin/hawala/pools/:id/designated-returns` can send back, and the
 * delta between balance and investments (non-zero in general: auto-invest
 * legs and withdrawals moved the balance without any investment row — the
 * pre-existing counter drift, surfaced rather than hidden). Totals included.
 *
 * Gated by FF_INVESTMENT_POOLS_V1 (the `/admin/hawala/pools*` matcher) AND
 * FF_NONPROFIT_PARITY_V1 (its own matcher in middlewares.ts, repeated here
 * and in the service); neither flag alone opens it. Admin-only reporting: no
 * owner check, so no existence oracle; a read that publishes is gated like the
 * writes. Medusa's route sorter registers this static segment ahead of the
 * sibling `[id]` route, so `designated` is never read as a pool id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (carrierFeatureDisabled(res)) return

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const report = await hawala.listDesignatedPoolFunds()
    return res.status(200).json(report)
  } catch (error) {
    return sendCarrierError(res, error)
  }
}
