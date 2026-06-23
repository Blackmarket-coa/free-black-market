import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * GET /admin/hawala/pools
 * List investment pools
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    producer_id,
    status,
    limit = "50",
    offset = "0",
  } = req.query

  const filters: Record<string, unknown> = {}
  if (producer_id) filters.producer_id = producer_id
  if (status) filters.status = status

  const pools = await hawalaService.listInvestmentPools({
    filters,
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
  })

  res.json({
    pools,
    count: pools.length,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
  })
}

/**
 * POST /admin/hawala/pools
 * Create a new investment pool
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const {
    name,
    description,
    producer_id,
    target_amount,
    minimum_investment,
    roi_type,
    fixed_roi_rate,
    revenue_share_percentage,
    product_credit_multiplier,
    start_date,
    end_date,
    auto_invest_enabled,
    auto_invest_percentage,
    metadata,
  } = req.body as {
    name: string
    description?: string
    producer_id: string
    target_amount: number
    minimum_investment?: number
    roi_type: string
    fixed_roi_rate?: number
    revenue_share_percentage?: number
    product_credit_multiplier?: number
    start_date?: string
    end_date?: string
    auto_invest_enabled?: boolean
    auto_invest_percentage?: number
    metadata?: Record<string, unknown>
  }

  if (!name || !producer_id || !target_amount || !roi_type) {
    return res.status(400).json({
      error: "name, producer_id, target_amount, and roi_type are required",
    })
  }

  try {
    // Create ledger account for pool
    const poolAccount = await hawalaService.createAccount({
      account_type: "PRODUCER_POOL",
      owner_type: "PRODUCER",
      owner_id: producer_id,
    })

    // Create investment pool
    const pool = await hawalaService.createInvestmentPools({
      name,
      description,
      producer_id,
      ledger_account_id: poolAccount.id,
      target_amount,
      minimum_investment: minimum_investment || 1,
      roi_type: roi_type as "FIXED_RATE" | "REVENUE_SHARE" | "PRODUCT_CREDIT" | "HYBRID",
      fixed_roi_rate,
      revenue_share_percentage,
      product_credit_multiplier,
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      auto_invest_enabled: auto_invest_enabled || false,
      auto_invest_percentage: auto_invest_percentage || 0,
      status: "ACTIVE",
      metadata,
    })

    res.status(201).json({ pool, account: poolAccount })
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
}
