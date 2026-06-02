import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"
import type FoodDistributionService from "../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const DeliveryPriorityEnum = z.enum([
  "STANDARD",
  "EXPRESS",
  "SCHEDULED",
  "ASAP",
  "BATCH",
  "VOLUNTEER",
])

const ProofTypeEnum = z.enum([
  "SIGNATURE",
  "PHOTO",
  "PIN_CODE",
  "NONE",
  "RECIPIENT_CONFIRMATION",
])

const createDeliverySchema = z.object({
  order_id: z.string(),
  
  // Priority
  priority: DeliveryPriorityEnum.optional(),
  
  // Pickup
  pickup_address: z.string().max(500),
  pickup_latitude: z.number().min(-90).max(90).optional(),
  pickup_longitude: z.number().min(-180).max(180).optional(),
  pickup_instructions: z.string().max(500).optional(),
  pickup_contact_name: z.string().max(255).optional(),
  pickup_contact_phone: z.string().max(20).optional(),
  
  // Delivery
  delivery_address: z.string().max(500),
  delivery_latitude: z.number().min(-90).max(90).optional(),
  delivery_longitude: z.number().min(-180).max(180).optional(),
  delivery_instructions: z.string().max(500).optional(),
  recipient_name: z.string().max(255),
  recipient_phone: z.string().max(20).optional(),
  
  // Contactless options
  contactless_delivery: z.boolean().optional(),
  leave_at_door: z.boolean().optional(),
  safe_place_description: z.string().max(255).optional(),
  
  // Timing
  estimated_pickup_at: z.string().datetime().optional(),
  estimated_delivery_at: z.string().datetime().optional(),
  
  // Proof
  proof_type: ProofTypeEnum.optional(),
  proof_pin_code: z.string().max(10).optional(),
  
  // Temperature
  requires_hot: z.boolean().optional(),
  requires_cold: z.boolean().optional(),
  
  // Fees
  delivery_fee: z.number().min(0).optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

const listDeliveriesQuerySchema = z.object({
  status: z.string().optional(),
  courier_id: z.string().optional(),
  producer_id: z.string().optional(),
  priority: DeliveryPriorityEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /food-deliveries
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listDeliveriesQuerySchema.parse(req.query)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.courier_id) filters.courier_id = query.courier_id
    if (query.producer_id) filters.producer_id = query.producer_id
    if (query.priority) filters.priority = query.priority
    
    const deliveries = await foodDistribution.listFoodDeliveries(filters, {
      take: query.limit,
      skip: query.offset,
      order: { created_at: "DESC" },
    })
    
    const count = await foodDistribution
      .listFoodDeliveries(filters, { select: ["id"] })
      .then((d) => d.length)
    
    res.json({
      deliveries,
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
// POST /food-deliveries
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = createDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const delivery = await foodDistribution.createDeliveryForOrder(data.order_id, {
      priority: data.priority || "STANDARD",
      pickup_address: data.pickup_address,
      pickup_latitude: data.pickup_latitude,
      pickup_longitude: data.pickup_longitude,
      pickup_instructions: data.pickup_instructions,
      pickup_contact_name: data.pickup_contact_name,
      pickup_contact_phone: data.pickup_contact_phone,
      delivery_address: data.delivery_address,
      delivery_latitude: data.delivery_latitude,
      delivery_longitude: data.delivery_longitude,
      delivery_instructions: data.delivery_instructions,
      recipient_name: data.recipient_name,
      recipient_phone: data.recipient_phone,
      contactless_delivery: data.contactless_delivery || false,
      leave_at_door: data.leave_at_door || false,
      safe_place_description: data.safe_place_description,
      estimated_pickup_at: data.estimated_pickup_at ? new Date(data.estimated_pickup_at) : null,
      estimated_delivery_at: data.estimated_delivery_at ? new Date(data.estimated_delivery_at) : null,
      proof_type: data.proof_type || "NONE",
      proof_pin_code: data.proof_pin_code,
      requires_hot: data.requires_hot || false,
      requires_cold: data.requires_cold || false,
      delivery_fee: data.delivery_fee || 0,
      metadata: data.metadata,
    })
    
    res.status(201).json({ delivery })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
