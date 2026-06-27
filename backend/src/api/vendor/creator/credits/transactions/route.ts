import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { listCreatorCreditTransactions } from "../../../../../lib/creator-hub"

/**
 * GET /vendor/creator/credits/transactions?limit=50
 * Coalition Credits (CCR rail) transaction history for the authenticated
 * creator, newest first. Direction is signed relative to the creator's wallets.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const limitRaw = Number((req.query.limit as string) ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const transactions = await listCreatorCreditTransactions(hawala, sellerId, limit)
  return res.json({ transactions, count: transactions.length })
}
