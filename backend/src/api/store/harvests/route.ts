import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../shared/actor-scope"
import { forbidden } from "../../../shared/community-read-access"

import { HARVEST_MODULE } from "../../../modules/harvest"

interface HarvestServiceType {
  createGardenHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateGardenHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  createHarvestAllocations: (data: Record<string, unknown>) => Promise<{ id: string }>
  createHarvestClaims: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateHarvestAllocations: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * Calculate harvest value with quality multiplier
 */
function estimateHarvestValue(
  quantity: number,
  pricePerUnit: number,
  qualityGrade: string
): number {
  const multipliers: Record<string, number> = {
    premium: 1.3,
    standard: 1.0,
    seconds: 0.7,
    processing: 0.4
  }
  const baseValue = quantity * pricePerUnit
  return baseValue * (multipliers[qualityGrade] || 1.0)
}

/**
 * GET /store/harvests
 * 
 * List harvests
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { garden_id, season_id, status } = req.query

  const filters: Record<string, unknown> = {}
  if (garden_id) filters.garden_id = garden_id
  if (season_id) filters.season_id = season_id
  if (status) filters.status = status

  const { data: harvests } = await query.graph({
    entity: "garden_harvest",
    fields: [
      "id",
      "garden_id",
      "season_id",
      "planting_id",
      "crop_type",
      "variety",
      "quantity",
      "unit",
      "quality_grade",
      "estimated_value",
      "harvested_at",
      "harvested_by_id",
      "status",
      "allocation_status",
    ],
    filters,
  })

  res.json({ harvests })
}

/**
 * POST /store/harvests
 * 
 * Record a new harvest
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  // Customers only. This record is written under a customer id, and that id
  // comes from the token. A seller or driver token used to fall through to
  // the id in the body, which let any signed-in seller or driver act as any
  // customer here.
  const actingCustomer = actingCustomerId(req)
  if (!actingCustomer) {
    return forbidden(res)
  }

  const harvestService = req.scope.resolve(HARVEST_MODULE) as HarvestServiceType

  const {
    garden_id,
    season_id,
    planting_id,
    crop_type,
    variety,
    quantity,
    unit,
    quality_grade,
    price_per_unit,
    notes,
    storage_location,
    photos,
  } = req.body as Record<string, unknown>

  // SEC: a customer may only record a harvest under their own id. Bind
  // harvested_by_id to the authenticated actor.
  const effectiveHarvestedById = actingCustomer

  // Calculate estimated value
  const estimated_value = estimateHarvestValue(
    quantity as number,
    (price_per_unit as number) || 0,
    (quality_grade as string) || "standard"
  )

  const harvest = await harvestService.createGardenHarvests({
    garden_id,
    season_id,
    planting_id,
    crop_type,
    variety,
    quantity,
    unit: unit || "lbs",
    quality_grade: quality_grade || "standard",
    estimated_value,
    harvested_at: new Date(),
    harvested_by_id: effectiveHarvestedById,
    status: "collected",
    allocation_status: "pending",
    notes,
    storage_location,
    photos,
  })

  res.status(201).json({ harvest })
}
