import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { CourierStatus } from "../../../modules/food-distribution/models/courier"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const CourierTypeEnum = z.enum([
  "INDEPENDENT",
  "EMPLOYEE",
  "VOLUNTEER",
  "COMMUNITY",
  "COOP_MEMBER",
])

const VehicleTypeEnum = z.enum([
  "CAR",
  "BIKE",
  "EBIKE",
  "MOTORCYCLE",
  "SCOOTER",
  "VAN",
  "TRUCK",
  "WALKING",
])

const createCourierSchema = z.object({
  email: z.string().email(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  
  courier_type: CourierTypeEnum,
  vehicle_type: VehicleTypeEnum,
  
  // Vehicle info
  vehicle_make: z.string().max(100).optional(),
  vehicle_model: z.string().max(100).optional(),
  vehicle_color: z.string().max(50).optional(),
  vehicle_plate: z.string().max(20).optional(),
  
  // Capacity
  max_deliveries_concurrent: z.number().int().min(1).max(10).optional(),
  has_insulated_bag: z.boolean().optional(),
  has_cold_storage: z.boolean().optional(),
  max_distance_miles: z.number().min(0).max(100).optional(),
  
  // Zone coverage
  service_area: z.array(z.string()).optional(),
  
  // Hawala
  hawala_account_id: z.string().optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const listCouriersQuerySchema = z.object({
  status: z.string().optional(),
  courier_type: CourierTypeEnum.optional(),
  vehicle_type: VehicleTypeEnum.optional(),
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /couriers
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listCouriersQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.courier_type) filters.courier_type = query.courier_type
    if (query.vehicle_type) filters.vehicle_type = query.vehicle_type
    if (query.is_active !== undefined) filters.active = query.is_active
    
    const couriers = await foodDistribution.listCouriers(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })
    
    const count = await foodDistribution
      .listCouriers(filters, { select: ["id"] })
      .then((c) => c.length)
    
    res.json({
      couriers,
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
// POST /couriers
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createCourierSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check for duplicate email
    const existing = await foodDistribution.listCouriers({ email: data.email })
    if (existing.length > 0) {
      res.status(400).json({ message: "A courier with this email already exists" })
      return
    }
    
    const courier = await foodDistribution.createCouriers({
      ...data,
      status: CourierStatus.OFFLINE,
      active: true,
      verified: false,
      total_deliveries: 0,
      total_earnings: 0,
      average_rating: 0,
    } as any)
    
    res.status(201).json({ courier })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
