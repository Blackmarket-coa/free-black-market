import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../modules/aid-network/service"
import { TransferReason } from "../../../../modules/aid-network/models/node-transfer"
import { getSellerId } from "../../quests/_helpers"
import { respondToServiceError } from "../_helpers"

const REASONS = new Set<string>(Object.values(TransferReason))

/** GET /vendor/aid-network/transfers — the seller's transfers. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)
  const node_transfers = await service.listNodeTransfers({ seller_id: sellerId })
  res.json({ node_transfers, count: node_transfers.length })
}

interface TransferBody {
  from_node_id: string
  to_node_id: string
  item_key: string
  item_label: string
  requested_qty: number
  unit_of_measure?: string
  reason?: string
  source_stock_id?: string
  requires_cold?: boolean
  courier_id?: string
  expected_at?: string
  notes?: string
}

/** POST /vendor/aid-network/transfers — open a transfer between two hubs. */
export const POST = async (
  req: MedusaRequest<TransferBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as TransferBody)
  for (const field of [
    "from_node_id",
    "to_node_id",
    "item_key",
    "item_label",
  ] as const) {
    if (!b[field]) return res.status(400).json({ message: `${field} is required` })
  }
  if (typeof b.requested_qty !== "number" || !Number.isFinite(b.requested_qty)) {
    return res.status(400).json({ message: "requested_qty must be a number" })
  }
  if (b.reason !== undefined && !REASONS.has(b.reason)) {
    return res
      .status(400)
      .json({ message: `reason must be one of: ${[...REASONS].join(", ")}` })
  }

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)

  try {
    const node_transfer = await service.requestTransfer({
      seller_id: sellerId,
      from_node_id: b.from_node_id,
      to_node_id: b.to_node_id,
      item_key: b.item_key,
      item_label: b.item_label,
      requested_qty: b.requested_qty,
      unit_of_measure: b.unit_of_measure,
      reason: b.reason as TransferReason | undefined,
      source_stock_id: b.source_stock_id ?? null,
      requires_cold: b.requires_cold ?? false,
      courier_id: b.courier_id ?? null,
      expected_at: b.expected_at ?? null,
      notes: b.notes ?? null,
    })
    res.status(201).json({ node_transfer })
  } catch (e) {
    if (respondToServiceError(e, res)) return
    throw e
  }
}
