import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildFarmHarvestConsistencyIssues } from "../../consistency"

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
 * GET /vendor/farm/harvests/:id
 * Get a specific harvest by ID
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id
  const harvestId = req.params.id

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

    // Get the harvest
    const { data: harvests } = await query.graph({
      entity: "harvest",
      fields: [
        "id",
        "producer_id",
        "crop_name",
        "variety",
        "category",
        "harvest_date",
        "planted_date",
        "season",
        "year",
        "growing_method",
        "field_name",
        "farmer_notes",
        "weather_notes",
        "taste_notes",
        "usage_tips",
        "photo",
        "gallery",
        "expected_yield_quantity",
        "expected_yield_unit",
        "visibility_status",
        "published_at",
        "created_at",
        "updated_at",
        "lots.*",
      ],
      filters: {
        id: harvestId,
        producer_id: producerId,
      },
    })

    if (!harvests || harvests.length === 0) {
      return res.status(404).json({ message: "Harvest not found" })
    }

    res.json({ harvest: harvests[0] })
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to fetch harvest", 
      error: error.message 
    })
  }
}

/**
 * PUT /vendor/farm/harvests/:id
 * Update a harvest
 */
export async function PUT(
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

    const { data: producers } = await query.graph({
      entity: "producer",
      fields: ["id", "year_established", "country_code", "state"],
      filters: { id: producerId },
      pagination: { take: 1 },
    })
    const producerProfile = (producers && producers[0]) || {}

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
      crop_name,
      variety,
      category,
      harvest_date,
      planted_date,
      season,
      year,
      growing_method,
      field_name,
      farmer_notes,
      weather_notes,
      taste_notes,
      usage_tips,
      photo,
      gallery,
      expected_yield_quantity,
      expected_yield_unit,
      visibility_status,
    } = req.body as Record<string, any>

    const consistency_issues = buildFarmHarvestConsistencyIssues(producerProfile as any, {
      year,
      harvest_date: harvest_date || null,
      planted_date: planted_date || null,
      field_name: field_name || null,
    })

    if (consistency_issues.length > 0) {
      return res.status(400).json({
        message: "Farm profile consistency checks failed",
        consistency_issues,
      })
    }

    // Update the harvest
    const harvest = await agricultureService.updateHarvests({
      id: harvestId,
      crop_name,
      variety,
      category,
      harvest_date,
      planted_date,
      season,
      year,
      growing_method,
      field_name,
      farmer_notes,
      weather_notes,
      taste_notes,
      usage_tips,
      photo,
      gallery,
      expected_yield_quantity,
      expected_yield_unit,
      visibility_status,
      published_at: visibility_status === "PUBLIC" ? new Date().toISOString() : null,
    })

    res.json({ harvest, consistency_issues })
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to update harvest", 
      error: error.message 
    })
  }
}

/**
 * DELETE /vendor/farm/harvests/:id
 * Delete a harvest
 */
export async function DELETE(
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

    const { data: producers } = await query.graph({
      entity: "producer",
      fields: ["id", "year_established", "country_code", "state"],
      filters: { id: producerId },
      pagination: { take: 1 },
    })
    const _producerProfile = (producers && producers[0]) || {}

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

    // Delete the harvest (will cascade to lots)
    await agricultureService.deleteHarvests(harvestId)

    res.status(204).send()
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to delete harvest", 
      error: error.message 
    })
  }
}
