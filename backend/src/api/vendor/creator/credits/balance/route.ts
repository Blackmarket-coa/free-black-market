import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { getCreatorCreditBalance } from "../../../../../lib/creator-hub"

/**
 * GET /vendor/creator/credits/balance
 * Coalition Credits (CCR rail) balance for the authenticated creator.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const balance = await getCreatorCreditBalance(hawala, sellerId)
  return res.json(balance)
}
