import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/vendor/hawala/payouts/config")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../../seller-context"

/**
 * GET /vendor/hawala/payouts/config
 * Get payout configuration for the authenticated vendor
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = await resolveVendorSellerId(req)
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Get payout config
    const configs = await hawalaService.listPayoutConfigs({
      vendor_id: vendorId,
    })

    if (configs.length === 0) {
      return res.json({ config: null, split_rules: [] })
    }

    const config = configs[0]

    // Get split rules
    const splitRules = await hawalaService.listPayoutSplitRules({
      payout_config_id: config.id,
    })

    res.json({
      config: {
        id: config.id,
        default_payout_tier: config.default_payout_tier,
        auto_payout_enabled: config.auto_payout_enabled,
        auto_payout_threshold: Number(config.auto_payout_threshold),
        auto_payout_day: config.auto_payout_day,
        instant_payout_eligible: config.instant_payout_eligible,
        instant_payout_daily_limit: Number(config.instant_payout_daily_limit),
        split_payout_enabled: config.split_payout_enabled,
        status: config.status,
      },
      split_rules: splitRules.map(r => ({
        id: r.id,
        destination_type: r.destination_type,
        percentage: Number(r.percentage),
        fixed_amount: r.fixed_amount ? Number(r.fixed_amount) : null,
        label: r.label,
        is_active: r.is_active,
      })),
    })
  } catch (error) {
    log.error("Error getting payout config:", error)
    res.status(400).json({ error: error.message })
  }
}

/**
 * PUT /vendor/hawala/payouts/config
 * Update payout configuration
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = await resolveVendorSellerId(req)
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const { 
      default_payout_tier,
      auto_payout_enabled,
      auto_payout_threshold,
      split_payout_enabled,
    } = req.body as {
      default_payout_tier?: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
      auto_payout_enabled?: boolean
      auto_payout_threshold?: number
      split_payout_enabled?: boolean
    }

    const updated = await hawalaService.updatePayoutConfiguration(vendorId, {
      default_payout_tier,
      auto_payout_enabled,
      auto_payout_threshold,
      split_payout_enabled,
    })

    res.json({ config: updated })
  } catch (error) {
    log.error("Error updating payout config:", error)
    res.status(400).json({ error: error.message })
  }
}
