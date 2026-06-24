import { createLogger } from "../../../../shared/logger"
import type { VendorRequest } from "../../types"
const log = createLogger("api/vendor/hawala/pools")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createPoolSchema, validateInput } from "../../../hawala-validation"

/**
 * GET /vendor/hawala/pools
 * Get vendor's producer investment pools
 *
 * OPTIMIZED: Uses batch query method to avoid N+1 database queries
 * Previously made 2*N queries (balance + investments for each pool),
 * now uses a single optimized method with parallel batch fetches
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    // OPTIMIZATION: Use batch method instead of N+1 queries
    const poolsWithDetails = await hawalaService.getVendorPoolsWithDetails(sellerId)

    res.json({ pools: poolsWithDetails })
  } catch (error) {
    log.error("Error listing pools:", error)
    res.status(500).json({ error: "Failed to retrieve pools" })
  }
}

/**
 * POST /vendor/hawala/pools
 * Create a new investment pool for the vendor
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  // Validate input using Zod schema
  const validation = validateInput(createPoolSchema, req.body)
  if (!validation.success) {
    return res.status(400).json({ error: validation.error })
  }
  const {
    name,
    description,
    target_amount,
    minimum_investment,
    roi_type,
    fixed_roi_rate,
    revenue_share_percentage,
    end_date,
    auto_invest_enabled,
    auto_invest_percentage,
  } = validation.data

  try {
    // Create ledger account for pool
    const poolAccount = await hawalaService.createAccount({
      account_type: "PRODUCER_POOL",
      owner_type: "PRODUCER",
      owner_id: sellerId,
    })

    // Create investment pool - cast entire input to bypass type checking for optional model fields
    const poolInput: Record<string, unknown> = {
      name,
      description,
      producer_id: sellerId,
      ledger_account_id: poolAccount.id,
      target_amount,
      minimum_investment: minimum_investment || 1,
      roi_type,
      revenue_share_percentage,
      status: "ACTIVE",
      auto_invest_enabled: auto_invest_enabled || false,
      auto_invest_percentage: auto_invest_percentage || 0,
    }
    if (fixed_roi_rate) poolInput.roi_rate = fixed_roi_rate
    if (end_date) poolInput.fundraising_end = new Date(end_date)
    
    const pool = await hawalaService.createInvestmentPools(poolInput)

    res.status(201).json({ pool, account: poolAccount })
  } catch (error) {
    log.error("Error creating pool:", error)
    res.status(400).json({ error: "Failed to create investment pool" })
  }
}
