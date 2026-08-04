import { createLogger } from "../../../../shared/logger"
import type { VendorRequest } from "../../types"
const log = createLogger("api/vendor/collective/demand-leads")
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

/**
 * GET /vendor/collective/demand-leads
 *
 * Demand that expired without anyone able to supply it. Separate from
 * `/vendor/collective/demand-pools`, which lists live pools a supplier can
 * still bid on — these are historical and cannot be bid on, so mixing them
 * into that list would fill an actionable feed with dead rows.
 *
 * This is what keeps unfulfilled demand from being a dead end: a pool nobody
 * could serve is the clearest signal of an unserved market.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const vendorId = (req as VendorRequest).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const category = req.query.category as string | undefined
    const delivery_region = req.query.delivery_region as string | undefined
    const min_committed_quantity = req.query.min_committed_quantity
      ? parseInt(req.query.min_committed_quantity as string)
      : undefined
    const limit = parseInt((req.query.limit as string) || "20")
    const offset = parseInt((req.query.offset as string) || "0")

    const leads = await demandPoolService.getUnfulfilledDemandLeads(vendorId, {
      category,
      delivery_region,
      min_committed_quantity,
      limit,
      offset,
    })

    res.json({
      demand_leads: leads,
      count: leads.length,
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    log.error("[GET /vendor/collective/demand-leads] Error:", message)
    res
      .status(500)
      .json({ error: "Failed to retrieve demand leads", details: message })
  }
}
