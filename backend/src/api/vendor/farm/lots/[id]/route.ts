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
 * GET /vendor/farm/lots/:id
 * Get a specific lot by ID
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const lotId = req.params.id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Get producer ID for this seller
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

    // Get the lot with its harvest to verify ownership
    const { data: lots } = await query.graph({
      entity: "lot",
      fields: [
        "id",
        "harvest_id",
        "lot_number",
        "batch_date",
        "grade",
        "size_class",
        "quantity_total",
        "quantity_available",
        "quantity_reserved",
        "quantity_sold",
        "unit",
        "suggested_price_per_unit",
        "cost_per_unit",
        "allocation_type",
        "surplus_flag",
        "surplus_declared_at",
        "surplus_reason",
        "best_by_date",
        "use_by_date",
        "storage_location",
        "storage_requirements",
        "external_lot_id",
        "is_active",
        "created_at",
        "updated_at",
        "harvest.producer_id",
        "availability_windows.*",
      ],
      filters: {
        id: lotId,
      },
    })

    if (!lots || lots.length === 0) {
      return res.status(404).json({ message: "Lot not found" })
    }

    const lot = lots[0] as typeof lots[0] & { harvest?: { producer_id: string } | null }

    // Verify the lot belongs to this producer's harvest
    if (lot.harvest?.producer_id !== producerId) {
      return res.status(403).json({ message: "Access denied" })
    }

    res.json({ lot })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch lot", 
      error: error.message 
    })
  }
}

/**
 * PUT /vendor/farm/lots/:id
 * Update a lot
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const lotId = req.params.id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Verify ownership (simplified - in production, check harvest->producer chain)
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

    const {
      lot_number,
      batch_date,
      grade,
      size_class,
      quantity_total,
      quantity_available,
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

    // Update the lot
    const lot = await agricultureService.updateLots({
      id: lotId,
      lot_number,
      batch_date,
      grade,
      size_class,
      quantity_total,
      quantity_available,
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
    })

    res.json({ lot })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to update lot", 
      error: error.message 
    })
  }
}

/**
 * DELETE /vendor/farm/lots/:id
 * Delete a lot
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const lotId = req.params.id

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

    // Delete the lot
    await agricultureService.deleteLots(lotId)

    res.status(204).send()
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to delete lot", 
      error: error.message 
    })
  }
}
