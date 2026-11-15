import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GARDEN_MODULE } from "../../../../modules/garden"
import { forbidden } from "../../../../shared/community-read-access"
import {
  actorManagesGarden,
  pickAllowed,
} from "../../../../shared/community-write-access"

interface GardenServiceType {
  updateGardens: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * What a garden's organizer may change through `PUT /store/gardens/:id`.
 *
 * Deliberately absent: `id`; `slug` (the garden's URL identity, unique);
 * `managing_org_id`; `total_plots` (derived, maintained by the plots route);
 * `current_season_id`; the six ledger account ids (`operating_account_id`,
 * `tool_fund_account_id`, `seed_fund_account_id`, `harvest_pool_account_id`,
 * `volunteer_credit_pool_id`, `investment_pool_account_id`), which route
 * money; and `settings` / `metadata`, free-form blobs nothing validates.
 */
const GARDEN_UPDATABLE_FIELDS = [
  "name",
  "description",
  "address",
  "city",
  "state",
  "zip",
  "coordinates",
  "producer_type",
  "total_sqft",
  "status",
  "governance_model",
  "contact_email",
  "contact_phone",
  "website",
  "cover_image_url",
  "gallery_urls",
] as const

/**
 * GET /store/gardens/:id
 * 
 * Get a specific garden by ID
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: [garden] } = await query.graph({
    entity: "garden",
    fields: [
      "id",
      "name",
      "slug",
      "description",
      "location.*",
      "size_sqft",
      "total_plots",
      "available_plots",
      "growing_zones",
      "membership_types",
      "governance_model",
      "voting_weights",
      "amenities",
      "contact_email",
      "contact_phone",
      "operating_hours",
      "image_urls",
      "status",
      "rules_document_url",
    ],
    filters: {
      id,
    },
  })

  if (!garden) {
    res.status(404).json({ message: "Garden not found" })
    return
  }

  res.json({ garden })
}

/**
 * PUT /store/gardens/:id
 * 
 * Update a garden. Its active organizers only, and only the fields in
 * `GARDEN_UPDATABLE_FIELDS`; anything else in the body is ignored. A garden
 * that does not exist is refused the same way as one the caller does not run.
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params

  if (!(await actorManagesGarden(req, id))) {
    return forbidden(res)
  }

  const gardenService = req.scope.resolve(GARDEN_MODULE) as GardenServiceType

  const garden = await gardenService.updateGardens({
    ...pickAllowed(req.body, GARDEN_UPDATABLE_FIELDS),
    id,
  })

  res.json({ garden })
}
