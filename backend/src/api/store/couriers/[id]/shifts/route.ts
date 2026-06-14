import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createShiftSchema = z.object({
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  zone_codes: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
})

const _updateShiftSchema = z.object({
  scheduled_start: z.string().datetime().optional(),
  scheduled_end: z.string().datetime().optional(),
  actual_start: z.string().datetime().optional(),
  actual_end: z.string().datetime().optional(),
  zone_codes: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
})

const listShiftsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /couriers/:id/shifts
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: courierId } = req.params
  
  try {
    const query = listShiftsQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify courier exists
    const courier = await foodDistribution.retrieveCourier(courierId)
    if (!courier) {
      res.status(404).json({ message: "Courier not found" })
      return
    }
    
    const filters: Record<string, any> = { courier: courierId }
    
    // Filter by date range
    if (query.from) {
      filters.scheduled_start = { $gte: new Date(query.from) }
    }
    if (query.to) {
      filters.scheduled_end = { $lte: new Date(query.to) }
    }
    
    const shifts = await foodDistribution.listCourierShifts(filters, {
      take: query.limit,
      skip: query.offset,
      order: { scheduled_start: "DESC" },
    })
    
    res.json({
      shifts,
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
// POST /couriers/:id/shifts
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: courierId } = req.params
  
  try {
    const data = createShiftSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify courier exists
    const courier = await foodDistribution.retrieveCourier(courierId)
    if (!courier) {
      res.status(404).json({ message: "Courier not found" })
      return
    }
    
    // Validate times
    const startTime = new Date(data.scheduled_start)
    const endTime = new Date(data.scheduled_end)
    
    if (endTime <= startTime) {
      res.status(400).json({ message: "End time must be after start time" })
      return
    }
    
    // Check for overlapping shifts
    const existingShifts = await foodDistribution.listCourierShifts({
      courier_id: courierId,
      scheduled_start: { $lte: endTime },
      scheduled_end: { $gte: startTime },
    })
    
    if (existingShifts.length > 0) {
      res.status(400).json({ message: "Shift overlaps with existing shift" })
      return
    }
    
    const shift = await foodDistribution.createCourierShifts({
      courier: courierId,
      scheduled_start: startTime,
      scheduled_end: endTime,
      assigned_zone: data.zone_codes?.[0] || null,
      notes: data.notes,
    } as any)
    
    res.status(201).json({ shift })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
