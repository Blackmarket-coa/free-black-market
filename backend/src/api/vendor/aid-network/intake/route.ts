import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../modules/aid-network/service"
import {
  DonorType,
  IntakeSource,
} from "../../../../modules/aid-network/models/intake-receipt"
import { getSellerId } from "../../quests/_helpers"
import { respondToServiceError } from "../_helpers"

const SOURCES = new Set<string>(Object.values(IntakeSource))
const DONOR_TYPES = new Set<string>(Object.values(DonorType))

interface IntakeLineBody {
  item_key?: string
  item_label?: string
  quantity?: number
  unit_of_measure?: string
  lot_code?: string
  expires_at?: string
  requires_cold?: boolean
}

interface IntakeBody {
  node_id: string
  source?: string
  donor_name?: string
  donor_type?: string
  donor_contact?: string
  received_at?: string
  received_by?: string
  estimated_value_cents?: number
  valuation_basis?: string
  currency_code?: string
  fund_id?: string
  notes?: string
  lines?: IntakeLineBody[]
}

/**
 * POST /vendor/aid-network/intake — record goods arriving with no purchase
 * behind them, and the stock they become.
 */
export const POST = async (
  req: MedusaRequest<IntakeBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as IntakeBody)
  if (!b.node_id) return res.status(400).json({ message: "node_id is required" })
  if (b.source !== undefined && !SOURCES.has(b.source)) {
    return res
      .status(400)
      .json({ message: `source must be one of: ${[...SOURCES].join(", ")}` })
  }
  if (b.donor_type !== undefined && !DONOR_TYPES.has(b.donor_type)) {
    return res.status(400).json({
      message: `donor_type must be one of: ${[...DONOR_TYPES].join(", ")}`,
    })
  }
  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    return res.status(400).json({ message: "at least one line is required" })
  }

  for (const [i, line] of b.lines.entries()) {
    if (!line?.item_key) {
      return res.status(400).json({ message: `lines[${i}].item_key is required` })
    }
    if (!line.item_label) {
      return res.status(400).json({ message: `lines[${i}].item_label is required` })
    }
    if (typeof line.quantity !== "number" || !(line.quantity > 0)) {
      return res
        .status(400)
        .json({ message: `lines[${i}].quantity must be greater than zero` })
    }
    if (line.expires_at && Number.isNaN(new Date(line.expires_at).getTime())) {
      return res
        .status(400)
        .json({ message: `lines[${i}].expires_at must be a valid date` })
    }
  }

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)

  try {
    const result = await service.recordIntake({
      seller_id: sellerId,
      node_id: b.node_id,
      source: b.source as IntakeSource | undefined,
      donor_name: b.donor_name ?? null,
      donor_type: b.donor_type as DonorType | undefined,
      donor_contact: b.donor_contact ?? null,
      received_at: b.received_at,
      received_by: b.received_by ?? null,
      estimated_value_cents: b.estimated_value_cents ?? null,
      valuation_basis: b.valuation_basis ?? null,
      currency_code: b.currency_code,
      fund_id: b.fund_id ?? null,
      notes: b.notes ?? null,
      lines: b.lines.map((l) => ({
        item_key: l.item_key as string,
        item_label: l.item_label as string,
        quantity: l.quantity as number,
        unit_of_measure: l.unit_of_measure,
        lot_code: l.lot_code ?? null,
        expires_at: l.expires_at ?? null,
        requires_cold: l.requires_cold ?? false,
      })),
    })
    res.status(201).json(result)
  } catch (e) {
    if (respondToServiceError(e, res)) return
    throw e
  }
}
