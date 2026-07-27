import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"

const SEASON_MODULE = "seasonModuleService"

interface SeasonServiceType {
  createGardenPlantings: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/seasons/:id/plantings
 * 
 * List plantings for a season
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: plantings } = await query.graph({
    entity: "garden_planting",
    fields: [
      "id",
      "plot_id",
      "crop_type",
      "variety",
      "planted_date",
      "expected_harvest_date",
      "actual_harvest_date",
      "status",
      "quantity_planted",
      "expected_yield",
      "actual_yield",
      "yield_unit",
    ],
    filters: {
      season_id: id,
    },
  })

  res.json({ plantings })
}

/**
 * POST /store/seasons/:id/plantings
 * 
 * Record a new planting
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const seasonService = req.scope.resolve(SEASON_MODULE) as SeasonServiceType

  // Get garden_id from season
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [season] } = await query.graph({
    entity: "garden_season",
    fields: ["garden_id"],
    filters: { id },
  })

  const {
    plot_id,
    crop_type,
    variety,
    category,
    planted_by_id,
    planted_date,
    expected_harvest_date,
    quantity_planted,
    expected_yield,
    yield_unit,
    seed_source,
    organic_certified,
    notes,
  } = req.body as Record<string, unknown>

  // SEC: bind the planting's recorder to the authenticated customer so a
  // logged-in customer cannot record a planting as someone else. Non-customer
  // actors (seller/driver) fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectivePlantedById = (actingCustomer ?? planted_by_id) as string

  const planting = await seasonService.createGardenPlantings({
    season_id: id,
    garden_id: season?.garden_id,
    plot_id,
    crop_type,
    variety,
    category: category || "vegetable",
    planted_by_id: effectivePlantedById,
    planted_date: planted_date ? new Date(planted_date as string) : new Date(),
    expected_harvest_date: expected_harvest_date ? new Date(expected_harvest_date as string) : null,
    quantity_planted,
    expected_yield,
    yield_unit: yield_unit || "lbs",
    seed_source,
    is_organic: organic_certified || false,
    status: "planted",
    notes,
  })

  res.status(201).json({ planting })
}
