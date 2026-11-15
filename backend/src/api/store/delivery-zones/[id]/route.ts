import { z } from "zod"
import { distanceMiles } from "../../../../lib/geo-distance"
import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { forbidden } from "../../../../shared/community-read-access"
import { requireSellerActor } from "../../../../shared/community-write-access"
import { POST as updateVendorZone } from "../../../vendor/delivery-zones/[id]/route"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

// Updates validate with /vendor's schema (api/delivery-zones/contracts.ts).

const checkCoverageSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

// ===========================================
// GET /delivery-zones/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const zone = await foodDistribution.retrieveDeliveryZone(id)
  
  if (!zone) {
    res.status(404).json({ message: "Delivery zone not found" })
    return
  }
  
  res.json({ zone })
}

// ===========================================
// PUT /delivery-zones/:id
//
// PUT and DELETE are the seller who created the zone, and nobody else — the
// same rule as /vendor/delivery-zones/:id (C-5). A zone with no
// `created_by_seller_id` predates ownership and is admin-managed, so it is not
// writable here either. Zones are a public catalogue (GET lists them), so a
// missing zone keeps its 404; existence is not a secret.
//
// PUT is /vendor/delivery-zones/:id's update handler, not a copy of it: that
// handler checks the owner, re-runs the overlap check on the merged zone (409
// DELIVERY_ZONE_CONFLICT) and converts the fees it is sent in dollars to the
// cents it stores. A second seller path here without those let a seller move
// an active zone over another, or re-price one in the wrong unit. Customers
// and drivers get the shared 403 before it is reached.
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerActor(req, res)
  if (!sellerId) return
  return updateVendorZone(
    req as unknown as AuthenticatedMedusaRequest<Record<string, unknown>, { id: string }>,
    res
  )
}

// ===========================================
// DELETE /delivery-zones/:id
//
// Deactivates rather than deletes (the /vendor twin hard-deletes). Turning a
// zone off cannot overlap anything and carries no fee, so neither of the
// checks PUT delegates for applies; the owner check is the whole of it.
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const sellerId = await requireSellerActor(req, res)
  if (!sellerId) return
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Check zone exists
  const existing = await foodDistribution.retrieveDeliveryZone(id)
  if (!existing) {
    res.status(404).json({ message: "Delivery zone not found" })
    return
  }
  if (!existing.created_by_seller_id || existing.created_by_seller_id !== sellerId) {
    return forbidden(res)
  }
  
  // Soft delete by deactivating
  await foodDistribution.updateDeliveryZones({
    id,
    active: false,
  })
  
  res.json({ success: true, id })
}

// ===========================================
// POST /delivery-zones/:id/check-coverage
// Check if coordinates are within zone
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = checkCoverageSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const zone = await foodDistribution.retrieveDeliveryZone(id)
    if (!zone) {
      res.status(404).json({ message: "Delivery zone not found" })
      return
    }
    
    // Simple point-in-polygon check
    // In production, use a proper GIS library
    const boundary = zone.boundary as { type: string; coordinates: number[][][] }
    const polygon = boundary.coordinates[0]
    
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1]
      const xj = polygon[j][0], yj = polygon[j][1]
      
      const intersect = ((yi > data.latitude) !== (yj > data.latitude)) &&
        (data.longitude < (xj - xi) * (data.latitude - yi) / (yj - yi) + xi)
      if (intersect) inside = !inside
    }
    
    // Calculate delivery fee if inside
    let deliveryFee: number | null = null
    if (inside) {
      const distance = distanceMiles(
        zone.center_latitude,
        zone.center_longitude,
        data.latitude,
        data.longitude
      )
      deliveryFee = await foodDistribution.calculateDeliveryFee(id, distance)
    }
    
    res.json({
      zone_id: id,
      zone_code: zone.code,
      is_covered: inside,
      active: zone.active,
      delivery_fee: deliveryFee,
      minimum_order: zone.minimum_order,
      avg_delivery_time_minutes: zone.avg_delivery_time_minutes,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
