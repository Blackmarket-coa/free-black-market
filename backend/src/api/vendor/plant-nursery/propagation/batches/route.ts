import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../../modules/nursery-vertical/service"
import {
  PROPAGATION_METHODS,
  type PropagationMethod,
} from "../../../../../modules/nursery-vertical/models"
import { getSellerId } from "../../../quests/_helpers"

/**
 * GET /vendor/plant-nursery/propagation/batches
 * This vendor's propagation batches (newest first). Returns a bare array to
 * match the nursery-portal `usePropagation` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const batches = await service.listBatchesForSeller(sellerId)
  res.json(batches)
}

interface CreateBatchBody {
  species_name?: string
  method?: string
  qty_started?: number
  expected_ready_at?: string
  pot_size?: string
  is_rare_species?: boolean
  hub_requested?: boolean
  notes?: string
}

/**
 * POST /vendor/plant-nursery/propagation/batches
 * Start a new propagation batch for this vendor.
 */
export const POST = async (
  req: MedusaRequest<CreateBatchBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? {}

  if (!b.species_name || typeof b.species_name !== "string") {
    return res.status(400).json({ message: "species_name is required" })
  }
  if (!b.method || !PROPAGATION_METHODS.includes(b.method as PropagationMethod)) {
    return res.status(400).json({
      message: `method must be one of: ${PROPAGATION_METHODS.join(", ")}`,
    })
  }
  const qtyStarted = Number(b.qty_started)
  if (!Number.isFinite(qtyStarted) || qtyStarted < 1) {
    return res
      .status(400)
      .json({ message: "qty_started must be a positive number" })
  }

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const batch = await service.startBatch(sellerId, {
    species_name: b.species_name,
    method: b.method as PropagationMethod,
    qty_started: qtyStarted,
    expected_ready_at: b.expected_ready_at,
    pot_size: b.pot_size,
    is_rare_species: b.is_rare_species,
    hub_requested: b.hub_requested,
    notes: b.notes,
  })

  res.status(201).json({ batch })
}
