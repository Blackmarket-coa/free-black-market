import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateZoneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  
  // GeoJSON polygon boundary
  boundary: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }).optional(),
  
  // Center point
  center_latitude: z.number().min(-90).max(90).optional(),
  center_longitude: z.number().min(-180).max(180).optional(),
  
  // Pricing
  base_delivery_fee: z.number().min(0).optional(),
  per_mile_fee: z.number().min(0).optional(),
  minimum_order: z.number().min(0).optional(),
  
  // Service hours
  service_hours: z.record(z.string(), z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  
  // Status
  active: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  
  // Stats
  avg_delivery_time_minutes: z.number().min(0).optional(),
  active_couriers: z.number().int().min(0).optional(),
})

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
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateZoneSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check zone exists
    const existing = await foodDistribution.retrieveDeliveryZone(id)
    if (!existing) {
      res.status(404).json({ message: "Delivery zone not found" })
      return
    }
    
    const zone = await foodDistribution.updateDeliveryZones({
      id,
      ...data,
    })
    
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
// DELETE /delivery-zones/:id
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Check zone exists
  const existing = await foodDistribution.retrieveDeliveryZone(id)
  if (!existing) {
    res.status(404).json({ message: "Delivery zone not found" })
    return
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
      // Calculate distance from center
      const R = 3959 // Earth radius in miles
      const dLat = (data.latitude - zone.center_latitude) * Math.PI / 180
      const dLon = (data.longitude - zone.center_longitude) * Math.PI / 180
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(zone.center_latitude * Math.PI / 180) * 
                Math.cos(data.latitude * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      const distance = R * c
      
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
