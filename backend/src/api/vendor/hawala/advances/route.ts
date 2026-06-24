import { createLogger } from "../../../../shared/logger"
import type { VendorRequest } from "../../types"
const log = createLogger("api/vendor/hawala/advances")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { requestAdvanceSchema, validateInput } from "../../../hawala-validation"

/**
 * GET /vendor/hawala/advances
 * Get advance eligibility and status for the authenticated vendor
 *
 * OPTIMIZED: Parallel fetching of eligibility and advances
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

    // Get vendor ID from auth context
    const vendorId = (req as VendorRequest).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // OPTIMIZATION: Fetch eligibility and advances in parallel
    const [eligibility, advances] = await Promise.all([
      hawalaService.calculateAdvanceEligibility(vendorId),
      hawalaService.listVendorAdvances({ vendor_id: vendorId }),
    ])

    res.json({
      eligibility,
      advances: advances.map(a => ({
        id: a.id,
        principal: Number(a.principal_amount),
        outstanding: Number(a.outstanding_balance),
        repaid: Number(a.total_repaid),
        fee_rate: Number(a.fee_rate),
        repayment_rate: Number(a.repayment_rate),
        term_days: a.term_days,
        start_date: a.start_date,
        expected_end_date: a.expected_end_date,
        actual_end_date: a.actual_end_date,
        status: a.status,
      })),
    })
  } catch (error) {
    log.error("Error getting advance info:", error)
    res.status(400).json({ error: "Failed to retrieve advance information" })
  }
}

/**
 * POST /vendor/hawala/advances
 * Request a new advance
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as VendorRequest).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Validate input using Zod schema
    const validation = validateInput(requestAdvanceSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({ error: validation.error })
    }
    const { amount, fee_rate, term_days } = validation.data

    const advance = await hawalaService.requestAdvance({
      vendor_id: vendorId,
      amount,
      fee_rate: fee_rate ?? 1.05,
      term_days: term_days ?? 30,
    })

    res.status(201).json({
      advance: {
        id: advance.id,
        principal: Number(advance.principal_amount),
        outstanding: Number(advance.outstanding_balance),
        fee_rate: Number(advance.fee_rate),
        repayment_rate: Number(advance.repayment_rate),
        term_days: advance.term_days,
        start_date: advance.start_date,
        expected_end_date: advance.expected_end_date,
        status: advance.status,
      },
    })
  } catch (error) {
    log.error("Error requesting advance:", error)
    res.status(400).json({ error: "Failed to request advance" })
  }
}
