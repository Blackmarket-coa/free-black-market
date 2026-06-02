import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"
import { OperatingStatus } from "../../../modules/food-distribution/models/food-producer"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const ProducerTypeEnum = z.enum([
  "RESTAURANT",
  "GHOST_KITCHEN",
  "COTTAGE_FOOD",
  "HOME_BAKER",
  "FOOD_BANK",
  "MUTUAL_AID",
  "COOPERATIVE",
  "FARM",
  "CSA",
  "FOOD_HUB",
  "COMMERCIAL_KITCHEN",
  "CATERER",
  "FOOD_TRUCK",
  "POP_UP",
  "OTHER",
])

const createProducerSchema = z.object({
  name: z.string().min(1).max(255),
  handle: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  producer_type: ProducerTypeEnum,
  
  description: z.string().max(2000).optional(),
  
  // Contact
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  
  // Address
  address_line_1: z.string().max(255).optional(),
  address_line_2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country_code: z.string().length(2).optional(),
  
  // Geo
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  
  // Operating hours (object with day keys)
  operating_hours: z.record(z.string(), z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  
  // Capabilities
  accepts_donations: z.boolean().optional(),
  accepts_trades: z.boolean().optional(),
  offers_delivery: z.boolean().optional(),
  offers_pickup: z.boolean().optional(),
  offers_dine_in: z.boolean().optional(),
  
  // Delivery settings
  delivery_radius_miles: z.number().min(0).max(100).optional(),
  minimum_order_amount: z.number().min(0).optional(),
  delivery_fee: z.number().min(0).optional(),
  estimated_prep_time_minutes: z.number().min(0).max(240).optional(),
  
  // Licensing
  license_type: z.string().max(100).optional(),
  license_number: z.string().max(100).optional(),
  license_expiry: z.string().datetime().optional(),
  health_permit_number: z.string().max(100).optional(),
  
  // Dietary options
  dietary_options: z.array(z.string()).optional(),
  cuisine_types: z.array(z.string()).optional(),
  
  // Payment options
  accepts_ebt: z.boolean().optional(),
  accepts_snap: z.boolean().optional(),
  
  // Hawala integration
  hawala_account_id: z.string().optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const updateProducerSchema = createProducerSchema.partial()

const listProducersQuerySchema = z.object({
  producer_type: ProducerTypeEnum.optional(),
  is_active: z.coerce.boolean().optional(),
  accepts_donations: z.coerce.boolean().optional(),
  accepts_trades: z.coerce.boolean().optional(),
  offers_delivery: z.coerce.boolean().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /food-producers
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listProducersQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    
    if (query.producer_type) filters.producer_type = query.producer_type
    if (query.is_active !== undefined) filters.operating_status = query.is_active ? OperatingStatus.ACCEPTING_ORDERS : OperatingStatus.CLOSED
    if (query.accepts_donations !== undefined) filters.accepts_donations = query.accepts_donations
    if (query.accepts_trades !== undefined) filters.accepts_trades = query.accepts_trades
    if (query.offers_delivery !== undefined) filters.offers_delivery = query.offers_delivery
    if (query.city) filters.city = query.city
    if (query.state) filters.state = query.state
    
    const [producers, count] = await Promise.all([
      foodDistribution.listFoodProducers(filters, {
        take: query.limit,
        skip: query.offset,
        order: { name: "ASC" },
      }),
      foodDistribution.listFoodProducers(filters, { select: ["id"] }).then((p) => p.length),
    ])
    
    res.json({
      producers,
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
// POST /food-producers
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createProducerSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check for duplicate handle
    const existing = await foodDistribution.listFoodProducers({ handle: data.handle })
    if (existing.length > 0) {
      res.status(400).json({ message: "A producer with this handle already exists" })
      return
    }
    
    const producer = await foodDistribution.createFoodProducers({
      ...data,
      operating_status: OperatingStatus.ACCEPTING_ORDERS,
      verified: false,
    } as any)
    
    res.status(201).json({ producer })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
