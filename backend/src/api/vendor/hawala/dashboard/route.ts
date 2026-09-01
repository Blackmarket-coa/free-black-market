import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/hawala/dashboard")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../seller-context"

/**
 * GET /vendor/hawala/dashboard
 * Get comprehensive financial dashboard for the authenticated vendor
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = await resolveVendorSellerId(req)
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Try to get existing dashboard, or create account if needed
    let dashboard
    try {
      dashboard = await hawalaService.getVendorDashboard(vendorId)
    } catch (error) {
      if (error.message === "Vendor account not found") {
        // Auto-create vendor account
        await hawalaService.createAccount({
          account_type: "SELLER_EARNINGS",
          owner_type: "SELLER",
          owner_id: vendorId,
          currency_code: "USD",
        })
        // Try again
        dashboard = await hawalaService.getVendorDashboard(vendorId)
      } else {
        throw error
      }
    }
    
    res.json({ dashboard })
  } catch (error) {
    log.error("Error getting vendor dashboard:", error)
    res.status(400).json({ error: error.message })
  }
}
