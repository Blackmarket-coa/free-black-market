import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deletedBody, dismissLinksBeforeDelete, farmFailure, farmId, farmIds, ownedLot } from "../../_access"
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
 * GET /vendor/farm/lots/:id
 * Get a specific lot by ID
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const params = farmIds(res, req.params, { id: farmId })
  if (!params) return
  const lotId = params.id

  try {
    // A lot of the caller's farm, through its harvest, or 403 (`_access.ts`).
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

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
      ],
      filters: {
        id: lotId,
      },
    })
    // `harvest.producer_id` and `availability_windows.*` were asked of the lot
    // itself, which the models do not relate ("Entity 'Lot' does not have
    // property 'harvest'", measured): read on their own.
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: ["*"],
      filters: { lot_id: lotId },
    })

    res.json({
      lot: {
        ...lots[0],
        harvest: { id: owned.harvest.id, producer_id: owned.harvest.producer_id },
        availability_windows: windows ?? [],
      },
    })
  } catch (error) {
    farmFailure(req, res, "Failed to fetch lot", error)
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
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const params = farmIds(res, req.params, { id: farmId })
  if (!params) return
  const lotId = params.id

  try {
    // The lot must be the caller's own, through its harvest. This checked only
    // that the caller had some farm profile, so any store with one could edit
    // another store's lot (SD-145 review). Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

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

    // Only the fields given (`shared/defined-fields.ts`): an omitted one,
    // passed as undefined, made every partial update a 500.
    const lot = await agricultureService.updateLots({
      id: lotId,
      ...definedFields({
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
      }),
    })

    res.json({ lot })
  } catch (error) {
    farmFailure(req, res, "Failed to update lot", error)
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
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const params = farmIds(res, req.params, { id: farmId })
  if (!params) return
  const lotId = params.id

  try {
    // The lot must be the caller's own, as for PUT: this deleted any store's
    // lot for a caller with any farm profile. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

    // Deleting the lot deletes its availability windows in the database (ON
    // DELETE CASCADE); their product links are dismissed first, so none
    // dangles (`dismissLinksBeforeDelete`).
    await dismissLinksBeforeDelete(req, { lotIds: [lotId] })
    await agricultureService.deleteLots(lotId)

    // Medusa's deletion body. A 204 with no body made the panel's SDK, which
    // parses every answer as JSON, report "Failed to delete" for a delete
    // that had happened.
    res.status(200).json(deletedBody("lot", lotId))
  } catch (error) {
    farmFailure(req, res, "Failed to delete lot", error)
  }
}
