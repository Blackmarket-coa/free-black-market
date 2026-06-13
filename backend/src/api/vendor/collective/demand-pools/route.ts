import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/collective/demand-pools")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../modules/demand-pool/service"

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

// GET /vendor/collective/demand-pools (supplier view of open demand pools)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const category = req.query.category as string | undefined
    const delivery_region = req.query.delivery_region as string | undefined
    const min_quantity = req.query.min_quantity
      ? parseInt(req.query.min_quantity as string)
      : undefined
    const limit = parseInt((req.query.limit as string) || "20")
    const offset = parseInt((req.query.offset as string) || "0")

    const opportunities = await demandPoolService.getSupplierOpportunities(
      vendorId,
      { category, delivery_region, min_quantity, limit, offset }
    )

    res.json({
      demand_pools: opportunities,
      count: opportunities.length,
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    log.error("[GET /vendor/collective/demand-pools] Error:", message)
    res.status(500).json({ error: "Failed to retrieve demand pools", details: message })
  }
}
