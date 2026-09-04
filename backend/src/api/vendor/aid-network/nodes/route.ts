import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../modules/aid-network/service"
import { NodeType } from "../../../../modules/aid-network/models/network-node"
import { getSellerId } from "../../quests/_helpers"

const NODE_TYPES = new Set<string>(Object.values(NodeType))

/** GET /vendor/aid-network/nodes — the seller's hubs. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)
  const nodes = await service.listNodesForSeller(sellerId)
  res.json({ network_nodes: nodes, count: nodes.length })
}

interface CreateNodeBody {
  name: string
  slug: string
  node_type?: string
  description?: string
  address_line_1?: string
  city?: string
  state?: string
  postal_code?: string
  country_code?: string
  latitude?: number
  longitude?: number
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  has_cold_storage?: boolean
  accepts_intake?: boolean
  accepts_transfers?: boolean
  metadata?: Record<string, unknown>
}

/** POST /vendor/aid-network/nodes — add a hub. */
export const POST = async (
  req: MedusaRequest<CreateNodeBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateNodeBody)
  if (!b.name) return res.status(400).json({ message: "name is required" })
  if (!b.slug) return res.status(400).json({ message: "slug is required" })
  if (b.node_type !== undefined && !NODE_TYPES.has(b.node_type)) {
    return res
      .status(400)
      .json({ message: `node_type must be one of: ${[...NODE_TYPES].join(", ")}` })
  }
  // Coordinates are optional, but half a coordinate is a bug, not a hub.
  const hasLat = typeof b.latitude === "number"
  const hasLon = typeof b.longitude === "number"
  if (hasLat !== hasLon) {
    return res
      .status(400)
      .json({ message: "latitude and longitude must be provided together" })
  }
  if (hasLat && (b.latitude! < -90 || b.latitude! > 90)) {
    return res.status(400).json({ message: "latitude must be between -90 and 90" })
  }
  if (hasLon && (b.longitude! < -180 || b.longitude! > 180)) {
    return res
      .status(400)
      .json({ message: "longitude must be between -180 and 180" })
  }

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)
  const network_node = await service.createNetworkNodes({
    seller_id: sellerId,
    name: b.name,
    slug: b.slug,
    node_type: (b.node_type ?? NodeType.PANTRY) as NodeType,
    description: b.description ?? null,
    address_line_1: b.address_line_1 ?? null,
    city: b.city ?? null,
    state: b.state ?? null,
    postal_code: b.postal_code ?? null,
    country_code: b.country_code ?? "US",
    latitude: hasLat ? b.latitude : null,
    longitude: hasLon ? b.longitude : null,
    contact_name: b.contact_name ?? null,
    contact_email: b.contact_email ?? null,
    contact_phone: b.contact_phone ?? null,
    has_cold_storage: b.has_cold_storage ?? false,
    accepts_intake: b.accepts_intake ?? true,
    accepts_transfers: b.accepts_transfers ?? true,
    metadata: b.metadata ?? null,
  })

  res.status(201).json({ network_node })
}
