import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../modules/buyer-network/service"

const createNetworkSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1).regex(/^[a-z0-9-]+$/, "Handle must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
  network_type: z.enum([
    "INDUSTRY_GROUP", "LOCAL_CHAPTER", "COOPERATIVE", "BUYING_CLUB", "TRADE_ASSOCIATION",
  ]).optional(),
  industry: z.string().optional(),
  categories: z.array(z.string()).optional(),
  region: z.string().optional(),
  is_public: z.boolean().optional(),
  requires_approval: z.boolean().optional(),
  min_purchase_commitment: z.number().positive().optional(),
  currency_code: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const discoverSchema = z.object({
  industry: z.string().optional(),
  region: z.string().optional(),
  network_type: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  my_networks: z.coerce.boolean().optional(),
})

// GET /store/collective/buyer-networks
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = discoverSchema.parse(req.query)
    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    if (query.my_networks) {
      const customerId = (req as any).auth_context?.actor_id
      if (!customerId) {
        return res.status(401).json({ error: "Unauthorized" })
      }
      const networks = await networkService.getMyNetworks(customerId)
      return res.json({ buyer_networks: networks })
    }

    const networks = await networkService.discoverNetworks({
      industry: query.industry,
      region: query.region,
      network_type: query.network_type,
      is_public: true,
      limit: query.limit,
      offset: query.offset,
    })

    res.json({
      buyer_networks: networks,
      count: networks.length,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error("[GET buyer-networks] Error:", error.message)
    res.status(500).json({ error: "Failed to retrieve networks" })
  }
}

// POST /store/collective/buyer-networks
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = createNetworkSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const network = await networkService.createNetwork({
      ...body,
      admin_id: customerId,
    })

    res.status(201).json({ buyer_network: network })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error("[POST buyer-networks] Error:", error.message)
    res.status(400).json({ error: error.message })
  }
}
