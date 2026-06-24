import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { requireSellerId } from "../../../../shared"
import { createDeliveryZoneSchema, updateDeliveryZoneSchema } from "../../../delivery-zones/contracts"
import { detectDeliveryZoneConflicts, type ExistingZone } from "../conflict-utils"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

// ===========================================
// GET /vendor/delivery-zones/:id
// Get a single delivery zone
// ===========================================

export async function GET(
  req: AuthenticatedMedusaRequest<never, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    const zone = await foodDistribution.retrieveDeliveryZone(id)

    if (!zone) {
      res.status(404).json({ message: "Delivery zone not found" })
      return
    }

    res.json({ zone })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /vendor/delivery-zones/:id
// Update a delivery zone
// ===========================================

export async function POST(
  req: AuthenticatedMedusaRequest<Record<string, unknown>, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const data = updateDeliveryZoneSchema.parse(req.body)
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Verify zone exists
    const existing = await foodDistribution.retrieveDeliveryZone(id)
    if (!existing) {
      res.status(404).json({ message: "Delivery zone not found" })
      return
    }


    const mergedCandidate = createDeliveryZoneSchema.parse({
      name: data.name ?? existing.name,
      code: existing.code,
      boundary: data.boundary ?? existing.boundary,
      center_latitude: data.center_latitude ?? existing.center_latitude,
      center_longitude: data.center_longitude ?? existing.center_longitude,
      base_delivery_fee:
        data.base_delivery_fee ?? Number(existing.base_delivery_fee || 0) / 100,
      per_mile_fee: data.per_mile_fee ?? Number(existing.per_mile_fee || 0) / 100,
      minimum_order:
        data.minimum_order === undefined
          ? existing.minimum_order
            ? Number(existing.minimum_order) / 100
            : undefined
          : data.minimum_order ?? undefined,
      service_hours: data.service_hours ?? (existing.service_hours as Record<string, { open: string; close: string }> | undefined),
      active: data.active ?? existing.active,
      priority: data.priority ?? existing.priority,
    })

    const activeZones = await foodDistribution.listDeliveryZones({ active: true })
    const conflicts = mergedCandidate.active
      ? detectDeliveryZoneConflicts(mergedCandidate, activeZones as unknown as ExistingZone[], id)
      : []

    if (conflicts.length) {
      return res.status(409).json({
        code: "DELIVERY_ZONE_CONFLICT",
        message: "Updated delivery zone overlaps with one or more active zones",
        details: { conflicts },
      })
    }

    // Prepare update data (convert dollars to cents)
    const updateData: Record<string, unknown> = { id }
    
    if (data.name !== undefined) updateData.name = data.name
    if (data.boundary !== undefined) updateData.boundary = data.boundary
    if (data.center_latitude !== undefined) updateData.center_latitude = data.center_latitude
    if (data.center_longitude !== undefined) updateData.center_longitude = data.center_longitude
    if (data.base_delivery_fee !== undefined) updateData.base_delivery_fee = Math.round(data.base_delivery_fee * 100)
    if (data.per_mile_fee !== undefined) updateData.per_mile_fee = Math.round(data.per_mile_fee * 100)
    if (data.minimum_order !== undefined) updateData.minimum_order = data.minimum_order ? Math.round(data.minimum_order * 100) : null
    if (data.service_hours !== undefined) updateData.service_hours = data.service_hours
    if (data.active !== undefined) updateData.active = data.active
    if (data.priority !== undefined) updateData.priority = data.priority

    const zone = await foodDistribution.updateDeliveryZones(updateData)

    res.json({ zone })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// DELETE /vendor/delivery-zones/:id
// Delete a delivery zone
// ===========================================

export async function DELETE(
  req: AuthenticatedMedusaRequest<never, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Verify zone exists
    const existing = await foodDistribution.retrieveDeliveryZone(id)
    if (!existing) {
      res.status(404).json({ message: "Delivery zone not found" })
      return
    }

    await foodDistribution.deleteDeliveryZones(id)

    res.status(204).send()
  } catch (error) {
    throw error
  }
}
