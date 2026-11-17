import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildFarmHarvestConsistencyIssues } from "../../consistency"
import { forbidden } from "../../../../../shared/community-read-access"
import { deletedBody, dismissLinksBeforeDelete, lotsByHarvest, ownedHarvest } from "../../_access"
import { definedFields } from "../../../../../shared/defined-fields"

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
  const harvestId = req.params.id

  try {
    // A harvest of the caller's farm, or 403 (`_access.ts`).
    const owned = await ownedHarvest(req, res, harvestId)
    if (!owned) return
    const producerId = owned.caller.producerId

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
      ],
      filters: {
        id: harvestId,
        producer_id: producerId,
      },
    })

    if (!harvests || harvests.length === 0) {
      return forbidden(res)
    }

    // Its lots, read on their own: the models define no relation.
    const lots = await lotsByHarvest(req, [harvestId])
    res.json({ harvest: { ...harvests[0], lots: lots.get(harvestId) ?? [] } })
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
  const harvestId = req.params.id

  try {
    // A harvest of the caller's farm, or 403 (`_access.ts`).
    const owned = await ownedHarvest(req, res, harvestId)
    if (!owned) return
    const producerId = owned.caller.producerId

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

    // Only the fields given (`shared/defined-fields.ts`): an omitted one,
    // passed as undefined, made every partial update a 500. `published_at`
    // follows `visibility_status` only when that is given.
    const harvest = await agricultureService.updateHarvests({
      id: harvestId,
      ...definedFields({
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
        published_at:
          visibility_status === undefined ? undefined : visibility_status === "PUBLIC" ? new Date().toISOString() : null,
      }),
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
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const harvestId = req.params.id

  try {
    // A harvest of the caller's farm, or 403 (`_access.ts`).
    const owned = await ownedHarvest(req, res, harvestId)
    if (!owned) return

    // Deleting the harvest deletes its lots and their availability windows in
    // the database (ON DELETE CASCADE); their link rows are dismissed first,
    // so none dangles (`dismissLinksBeforeDelete`).
    const query = req.scope.resolve("query")
    const { data: lots } = await query.graph({ entity: "lot", fields: ["id"], filters: { harvest_id: harvestId } })
    await dismissLinksBeforeDelete(req, {
      harvest: owned.harvest,
      lotIds: (lots ?? []).map((l: { id: string }) => l.id),
    })
    await agricultureService.deleteHarvests(harvestId)

    // Medusa's deletion body. A 204 with no body made the panel's SDK, which
    // parses every answer as JSON, report "Failed to delete" for a delete
    // that had happened.
    res.status(200).json(deletedBody("harvest", harvestId))
  } catch (error: any) {
    res.status(500).json({ 
      message: "Failed to delete harvest", 
      error: error.message 
    })
  }
}
