import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/collective/buyer-networks")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../modules/buyer-network/service"

const listSchema = z.object({
  status: z.string().optional(),
  network_type: z.string().optional(),
  region: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// GET /admin/collective/buyer-networks
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = listSchema.parse(req.query)
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.network_type) filters.network_type = query.network_type
    if (query.region) filters.region = query.region

    const [networks, count] = await networkService.listAndCountBuyerNetworks(
      filters,
      {
        skip: query.offset,
        take: query.limit,
        order: { member_count: "DESC" },
      }
    )

    res.json({
      buyer_networks: networks,
      count,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error("[GET /admin/collective/buyer-networks] Error:", error.message)
    res.status(500).json({ error: "Failed to retrieve buyer networks" })
  }
}
