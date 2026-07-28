import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { OperatingStatus } from "../../../../modules/food-distribution/models/food-producer"
import { actorMayManage } from "../../../../shared/actor-scope"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateProducerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
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
  
  // Operating hours
  operating_hours: z.record(z.string(), z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  
  // Status
  is_active: z.boolean().optional(),
  is_open: z.boolean().optional(),
  
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
  
  // Payment
  accepts_ebt: z.boolean().optional(),
  accepts_snap: z.boolean().optional(),
  
  metadata: z.record(z.string(), z.any()).optional(),
})

// ===========================================
// GET /food-producers/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  try {
    const producer = await foodDistribution.retrieveFoodProducer(id)
    
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    
    // Check if currently open
    const isOpen = await foodDistribution.isProducerOpen(id)
    
    res.json({
      producer: {
        ...producer,
        is_currently_open: isOpen,
      },
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// PUT /food-producers/:id
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateProducerSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check producer exists
    const existing = await foodDistribution.retrieveFoodProducer(id)
    if (!existing) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    if (!actorMayManage(req, (existing as any).owner_id)) {
      res.status(403).json({ message: "This producer is not yours to manage" })
      return
    }

    const producer = await foodDistribution.updateFoodProducers({
      id,
      ...data,
    } as any)
    
    res.json({ producer })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// DELETE /food-producers/:id
// ===========================================

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Check producer exists
  const existing = await foodDistribution.retrieveFoodProducer(id)
  if (!existing) {
    res.status(404).json({ message: "Producer not found" })
    return
  }
  if (!actorMayManage(req, (existing as any).owner_id)) {
    res.status(403).json({ message: "This producer is not yours to manage" })
    return
  }

  // Soft delete by deactivating
  await foodDistribution.updateFoodProducers({
    id,
    operating_status: OperatingStatus.CLOSED,
  } as any)
  
  res.status(200).json({ success: true, id })
}
