import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { requireSellerId } from "../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

import { createDeliveryZoneSchema } from "../../delivery-zones/contracts"
import { detectDeliveryZoneConflicts } from "./conflict-utils"

const listZonesQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /vendor/delivery-zones
// List all delivery zones for the vendor
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const query = listZonesQuerySchema.parse(req.query)
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Note: In a full implementation, zones would be filtered by producer_id.
    // For now, we return all zones for any authenticated vendor.
    const filters: Record<string, any> = {}
    if (query.active !== undefined) filters.active = query.active

    const zones = await foodDistribution.listDeliveryZones(filters, {
      take: query.limit,
      skip: query.offset,
      order: { priority: "DESC", name: "ASC" },
    })

    const count = await foodDistribution
      .listDeliveryZones(filters, { select: ["id"] })
      .then((z) => z.length)

    res.json({
      zones,
      count,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// POST /vendor/delivery-zones
// Create a new delivery zone
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const data = createDeliveryZoneSchema.parse(req.body)
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Check for duplicate code
    const existing = await foodDistribution.listDeliveryZones({ code: data.code })
    if (existing.length > 0) {
      res.status(400).json({ message: "A zone with this code already exists" })
      return
    }

    const activeZones = await foodDistribution.listDeliveryZones({ active: true })
    const conflicts = data.active
      ? detectDeliveryZoneConflicts(data, activeZones as any)
      : []

    if (conflicts.length) {
      return res.status(409).json({
        code: "DELIVERY_ZONE_CONFLICT",
        message: "Delivery zone overlaps with one or more active zones",
        details: { conflicts },
      })
    }

    // Create the zone
    const zone = await foodDistribution.createDeliveryZones({
      ...data,
      // Convert dollars to cents for storage
      base_delivery_fee: Math.round(data.base_delivery_fee * 100),
      per_mile_fee: Math.round(data.per_mile_fee * 100),
      minimum_order: data.minimum_order ? Math.round(data.minimum_order * 100) : undefined,
    })

    res.status(201).json({ zone })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
