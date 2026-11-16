import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"
import { actorMayManage, actorOwnsResource } from "../../../../../shared/actor-scope"
import { forbidden } from "../../../../../shared/community-read-access"

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

/**
 * The courier's owner only. `api/middlewares.ts` authenticates the write
 * verbs on `/store/couriers`, not this GET, and it returned every shift of
 * any courier to a caller holding only a publishable key: when a named person
 * starts and stops work, in which zone, their notes, and what each shift
 * earned. `publicCourierView` already keeps `weekly_schedule` ("when they are
 * and are not out") and earnings out of what a stranger may see of a
 * courier; this route published the same facts shift by shift.
 *
 * `actorOwnsResource`, not `actorMayManage`: a courier with no owner on
 * record is not thereby everyone's to read. A courier id that does not exist
 * keeps its 404: couriers are a public catalogue (`GET /store/couriers`), so
 * that says nothing the list does not.
 */
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
    if (!actorOwnsResource(req, (courier as { owner_id?: string | null }).owner_id)) {
      return forbidden(res)
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
    if (!actorMayManage(req, (courier as any).owner_id)) {
      res.status(403).json({ message: "This courier is not yours to manage" })
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
