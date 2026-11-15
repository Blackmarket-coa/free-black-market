import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GARDEN_MODULE } from "../../../../../modules/garden"
import { forbidden } from "../../../../../shared/community-read-access"
import { actorManagesGarden } from "../../../../../shared/community-write-access"

interface GardenServiceType {
  createGardenPlots: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateGardens: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/gardens/:id/plots
 * 
 * List all plots in a garden
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: plots } = await query.graph({
    entity: "garden_plot",
    fields: [
      "id",
      "plot_number",
      "size_sqft",
      "soil_zone_id",
      "status",
      "sun_exposure",
      "has_raised_bed",
      "season_fee",
      "assigned_to_id",
    ],
    filters: {
      garden_id: id,
    },
  })

  res.json({ plots })
}

/**
 * POST /store/gardens/:id/plots
 * 
 * Create a new plot in a garden. The garden's active organizers only.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params

  if (!(await actorManagesGarden(req, id))) {
    return forbidden(res)
  }

  const gardenService = req.scope.resolve(GARDEN_MODULE) as GardenServiceType

  const {
    plot_number,
    size_sqft,
    soil_zone_id,
    sun_exposure,
    has_water_access,
    has_raised_bed,
    season_fee,
  } = req.body as Record<string, unknown>

  const plot = await gardenService.createGardenPlots({
    garden_id: id,
    plot_number,
    size_sqft,
    soil_zone_id,
    sun_exposure,
    has_water_access: has_water_access || false,
    has_raised_bed: has_raised_bed || false,
    season_fee,
    status: "available",
  })

  // Update garden plot count
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [garden] } = await query.graph({
    entity: "garden",
    fields: ["id", "total_plots"],
    filters: { id },
  })

  if (garden) {
    await gardenService.updateGardens({
      id,
      total_plots: ((garden.total_plots as number) || 0) + 1,
    })
  }

  res.status(201).json({ plot })
}
