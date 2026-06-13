import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/hawala/payouts")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /vendor/hawala/payouts
 * Get available payout options for the authenticated vendor
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const options = await hawalaService.getPayoutOptions(vendorId)
    
    res.json({ payout_options: options })
  } catch (error: any) {
    log.error("Error getting payout options:", error)
    res.status(400).json({ error: error.message })
  }
}

/**
 * POST /vendor/hawala/payouts
 * Request a payout
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const { amount, payout_tier, bank_account_id } = req.body as {
      amount: number
      payout_tier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
      bank_account_id?: string
    }

    if (!amount || !payout_tier) {
      return res.status(400).json({ error: "amount and payout_tier are required" })
    }

    const payoutRequest = await hawalaService.requestPayout({
      vendor_id: vendorId,
      amount,
      payout_tier,
      bank_account_id,
    })

    res.status(201).json({ payout_request: payoutRequest })
  } catch (error: any) {
    log.error("Error requesting payout:", error)
    res.status(400).json({ error: error.message })
  }
}
