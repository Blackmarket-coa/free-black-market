import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildFarmHarvestConsistencyIssues } from "../consistency"

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

// Type for link service methods
interface LinkServiceType {
  create: (data: Record<string, unknown>) => Promise<unknown[]>
}

/**
 * GET /vendor/farm/harvests
 * List all harvests for the current farm
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { limit = 50, offset = 0 } = req.query as Record<string, any>

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
      return res.json({ harvests: [], count: 0 })
    }

    const producerId = producerLinks[0].producer_id

    // Get harvests for this producer
    const { data: harvests } = await query.graph({
      entity: "harvest",
      fields: [
        "id",
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
        producer_id: producerId
      },
      pagination: {
        skip: parseInt(offset as string, 10),
        take: parseInt(limit as string, 10),
        order: { created_at: "DESC" }
      }
    })

    res.json({ 
      harvests: harvests || [],
      count: harvests?.length || 0,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    })
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to fetch harvests", 
      error: error.message 
    })
  }
}

/**
 * POST /vendor/farm/harvests
 * Create a new harvest
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const linkService = req.scope.resolve("link") as LinkServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

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
      return res.status(400).json({ 
        message: "Please create a farm profile first" 
      })
    }

    const producerId = producerLinks[0].producer_id

    const { data: producers } = await query.graph({
      entity: "producer",
      fields: ["id", "year_established", "country_code", "state"],
      filters: { id: producerId },
      pagination: { take: 1 },
    })
    const producerProfile = (producers && producers[0]) || {}

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
      year: year || new Date().getFullYear(),
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

    // Create the harvest
    const harvest = await agricultureService.createHarvests({
      producer_id: producerId,
      crop_name,
      variety,
      category,
      harvest_date,
      planted_date,
      season: season || "SUMMER",
      year: year || new Date().getFullYear(),
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
      visibility_status: visibility_status || "DRAFT",
    })

    // Link harvest to producer
    await linkService.create({
      harvest_producer: {
        harvest_id: harvest.id,
        producer_id: producerId,
      }
    })

    res.status(201).json({ harvest, consistency_issues })
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to create harvest", 
      error: error.message 
    })
  }
}
