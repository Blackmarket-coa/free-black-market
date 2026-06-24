import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Type for agriculture service methods
interface AgricultureServiceType {
  createHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteHarvests: (id: string) => Promise<void>
  createLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteLots: (id: string) => Promise<void>
  createAvailabilityWindows: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * POST /vendor/farm/harvests/:id/lots
 * Create a new lot for a harvest
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const harvestId = req.params.id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Verify ownership
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.status(403).json({ message: "No farm profile found" })
    }

    const producerId = producerLinks[0].producer_id

    // Verify harvest belongs to this producer
    const { data: existingHarvests } = await query.graph({
      entity: "harvest",
      fields: ["id"],
      filters: {
        id: harvestId,
        producer_id: producerId,
      },
    })

    if (!existingHarvests || existingHarvests.length === 0) {
      return res.status(404).json({ message: "Harvest not found" })
    }

    const {
      lot_number,
      batch_date,
      grade,
      size_class,
      quantity_total,
      unit,
      suggested_price_per_unit,
      cost_per_unit,
      allocation_type,
      best_by_date,
      use_by_date,
      storage_location,
      storage_requirements,
      external_lot_id,
      is_active,
    } = req.body as Record<string, unknown>

    // Generate lot number if not provided
    const finalLotNumber = lot_number || 
      `LOT-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`

    // Create the lot
    const lot = await agricultureService.createLots({
      harvest_id: harvestId,
      lot_number: finalLotNumber,
      batch_date,
      grade: grade || "GRADE_A",
      size_class,
      quantity_total: quantity_total || 0,
      quantity_available: quantity_total || 0,
      quantity_reserved: 0,
      quantity_sold: 0,
      unit: unit || "lb",
      suggested_price_per_unit,
      cost_per_unit,
      allocation_type: allocation_type || "RETAIL",
      surplus_flag: false,
      best_by_date,
      use_by_date,
      storage_location,
      storage_requirements,
      external_lot_id,
      is_active: is_active !== false,
    })

    res.status(201).json({ lot })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to create lot", 
      error: error.message 
    })
  }
}
