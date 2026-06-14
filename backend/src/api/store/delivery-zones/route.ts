import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createZoneSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).regex(/^[A-Z0-9-]+$/),
  
  // GeoJSON polygon boundary
  boundary: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  
  // Center point
  center_latitude: z.number().min(-90).max(90),
  center_longitude: z.number().min(-180).max(180),
  
  // Pricing
  base_delivery_fee: z.number().min(0).default(0),
  per_mile_fee: z.number().min(0).default(0),
  minimum_order: z.number().min(0).optional(),
  
  // Service hours (per day)
  service_hours: z.record(z.string(), z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  
  // Status
  active: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
})

const _updateZoneSchema = createZoneSchema.partial()

const listZonesQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /delivery-zones
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listZonesQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
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
// POST /delivery-zones
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createZoneSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check for duplicate code
    const existing = await foodDistribution.listDeliveryZones({ code: data.code })
    if (existing.length > 0) {
      res.status(400).json({ message: "A zone with this code already exists" })
      return
    }
    
    const zone = await foodDistribution.createDeliveryZones(data)
    
    res.status(201).json({ zone })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
