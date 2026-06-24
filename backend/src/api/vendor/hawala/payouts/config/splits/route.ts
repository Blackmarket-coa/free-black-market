import { createLogger } from "../../../../../../shared/logger"
import type { VendorRequest } from "../../../../types"
const log = createLogger("api/vendor/hawala/payouts/config/splits")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"

/**
 * POST /vendor/hawala/payouts/config/splits
 * Add or update a split rule
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as VendorRequest).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const {
      destination_type,
      percentage,
      destination_ledger_account_id,
      destination_bank_account_id,
      label,
    } = req.body as {
      destination_type: string
      percentage: number
      destination_ledger_account_id?: string
      destination_bank_account_id?: string
      label?: string
    }

    if (!destination_type || percentage === undefined) {
      return res.status(400).json({ 
        error: "destination_type and percentage are required" 
      })
    }

    // Get or create payout config
    const configs = await hawalaService.listPayoutConfigs({
      vendor_id: vendorId,
    })

    if (configs.length === 0) {
      return res.status(400).json({ error: "Payout config not found. Please set up payout preferences first." })
    }

    const config = configs[0]

    const rule = await hawalaService.upsertSplitRule({
      vendor_id: vendorId,
      payout_config_id: config.id,
      destination_type,
      percentage,
      destination_ledger_account_id,
      destination_bank_account_id,
      label,
    })

    res.status(201).json({ split_rule: rule })
  } catch (error) {
    log.error("Error creating split rule:", error)
    res.status(400).json({ error: error.message })
  }
}

/**
 * GET /vendor/hawala/payouts/config/splits
 * Get all split rules for the vendor
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as VendorRequest).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Get payout config
    const configs = await hawalaService.listPayoutConfigs({
      vendor_id: vendorId,
    })

    if (configs.length === 0) {
      return res.json({ split_rules: [] })
    }

    const rules = await hawalaService.listPayoutSplitRules({
      payout_config_id: configs[0].id,
    })

    res.json({
      split_rules: rules.map(r => ({
        id: r.id,
        destination_type: r.destination_type,
        percentage: Number(r.percentage),
        fixed_amount: r.fixed_amount ? Number(r.fixed_amount) : null,
        label: r.label,
        is_active: r.is_active,
      })),
    })
  } catch (error) {
    log.error("Error getting split rules:", error)
    res.status(400).json({ error: error.message })
  }
}
