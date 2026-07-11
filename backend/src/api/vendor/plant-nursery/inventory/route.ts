import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NURSERY_VERTICAL_MODULE } from "../../../../modules/nursery-vertical"
import type NurseryVerticalModuleService from "../../../../modules/nursery-vertical/service"
import { getSellerId } from "../../quests/_helpers"

/** Batch statuses that count as sellable, on-hand stock. */
const READY_STATUSES = ["ready", "listed"]
/** Terminal statuses that are neither in propagation nor in stock. */
const DONE_STATUSES = ["ready", "listed", "sold_out", "failed"]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /vendor/plant-nursery/inventory
 * The vendor's inventory view: sellable stock (derived from ready/listed
 * propagation batches), batches still in propagation, and mother plants.
 * Matches the nursery-portal `useInventory` hook contract.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<NurseryVerticalModuleService>(
    NURSERY_VERTICAL_MODULE
  )
  const [batches, motherPlants] = await Promise.all([
    service.listBatchesForSeller(sellerId),
    service.listMotherPlantsForSeller(sellerId),
  ])

  const now = Date.now()
  const ready = batches
    .filter((b) => READY_STATUSES.includes(b.status))
    .map((b) => ({
      id: b.id,
      species_name: b.species_name,
      method: b.method,
      // Successful count once graded; fall back to started count before then.
      quantity: b.qty_successful > 0 ? b.qty_successful : b.qty_started,
      pot_size: b.pot_size ?? undefined,
      days_in_stock: Math.max(
        0,
        Math.floor((now - new Date(b.expected_ready_at).getTime()) / DAY_MS)
      ),
    }))

  const in_propagation = batches.filter((b) => !DONE_STATUSES.includes(b.status))

  res.json({ ready, in_propagation, mother_plants: motherPlants })
}
