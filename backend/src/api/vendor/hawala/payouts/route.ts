import { createLogger } from "../../../../shared/logger"
import type { VendorRequest } from "../../types"
const log = createLogger("api/vendor/hawala/payouts")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../seller-context"

/**
 * GET /vendor/hawala/payouts
 * Get available payout options for the authenticated vendor
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = await resolveVendorSellerId(req)
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const options = await hawalaService.getPayoutOptions(vendorId)
    
    res.json({ payout_options: options })
  } catch (error) {
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
    const vendorId = await resolveVendorSellerId(req)
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const { amount, payout_tier, bank_account_id } = req.body as {
      amount: number
      payout_tier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
      bank_account_id?: string
    }

    if (!payout_tier) {
      return res.status(400).json({ error: "amount and payout_tier are required" })
    }

    // Amount must be a positive, finite number. The `!amount` shorthand
    // previously used here treated only 0/NaN/undefined as invalid and let
    // negative amounts through — a negative payout inverts the ledger transfer
    // and drains the platform settlement account into the caller's earnings.
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" })
    }

    const payoutRequest = await hawalaService.requestPayout({
      vendor_id: vendorId,
      amount,
      payout_tier,
      bank_account_id,
    })

    res.status(201).json({ payout_request: payoutRequest })
  } catch (error) {
    log.error("Error requesting payout:", error)
    res.status(400).json({ error: error.message })
  }
}
