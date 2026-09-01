import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../../types"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../../seller-context"

/**
 * GET /vendor/hawala/pools/:id
 * Get pool details and investors
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const sellerId = await resolveVendorSellerId(req)
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    const pool = await hawalaService.retrieveInvestmentPool(id)
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" })
    }

    // Verify ownership
    if (pool.producer_id !== sellerId) {
      return res.status(403).json({ error: "Access denied" })
    }

    const balance = await hawalaService.getAccountBalance(pool.ledger_account_id)
    const investments = await hawalaService.listInvestments({
      pool_id: id,
    })

    res.json({ pool, balance, investments })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}

/**
 * PATCH /vendor/hawala/pools/:id
 * Update pool settings
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const sellerId = await resolveVendorSellerId(req)
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    const pool = await hawalaService.retrieveInvestmentPool(id)
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" })
    }

    if (pool.producer_id !== sellerId) {
      return res.status(403).json({ error: "Access denied" })
    }

    const {
      name,
      description,
      status,
      auto_invest_enabled,
      auto_invest_percentage,
    } = req.body as {
      name?: string
      description?: string
      status?: string
      auto_invest_enabled?: boolean
      auto_invest_percentage?: number
    }

    const updateData: Record<string, unknown> = { id }
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (status) updateData.status = status
    if (auto_invest_enabled !== undefined) updateData.auto_invest_enabled = auto_invest_enabled
    if (auto_invest_percentage !== undefined) updateData.auto_invest_percentage = auto_invest_percentage

    const updatedPool = await hawalaService.updateInvestmentPools(updateData)

    res.json({ pool: updatedPool })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
}
