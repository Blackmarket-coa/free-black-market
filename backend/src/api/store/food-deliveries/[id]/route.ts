import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { DeliveryStatus } from "../../../../modules/food-distribution/models/delivery"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const DeliveryStatusEnum = z.enum([
  "PENDING",
  "ASSIGNED",
  "COURIER_EN_ROUTE_PICKUP",
  "COURIER_ARRIVED_PICKUP",
  "WAITING_FOR_ORDER",
  "ORDER_PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "ARRIVED_AT_DESTINATION",
  "ATTEMPTING_DELIVERY",
  "DELIVERED",
  "DELIVERED_TO_NEIGHBOR",
  "DELIVERED_TO_SAFE_PLACE",
  "DELIVERY_FAILED",
  "CUSTOMER_NOT_AVAILABLE",
  "WRONG_ADDRESS",
  "REFUSED",
  "RETURNED_TO_PRODUCER",
  "CANCELLED",
])

const updateDeliverySchema = z.object({
  status: DeliveryStatusEnum.optional(),
  
  // Location update
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  
  // Notes
  notes: z.string().max(500).optional(),
  
  // Issue reporting
  has_issue: z.boolean().optional(),
  issue_type: z.string().max(100).optional(),
  issue_description: z.string().max(500).optional(),
  
  // Rating
  customer_rating: z.number().min(1).max(5).optional(),
  customer_feedback: z.string().max(500).optional(),
})

const proofOfDeliverySchema = z.object({
  proof_type: z.enum(["SIGNATURE", "PHOTO", "PIN_CODE", "RECIPIENT_CONFIRMATION"]),
  photo_url: z.string().url().optional(),
  signature_url: z.string().url().optional(),
  pin_code: z.string().max(10).optional(),
  recipient_name: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
})

// ===========================================
// GET /food-deliveries/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const delivery = await foodDistribution.retrieveFoodDelivery(id)
  
  if (!delivery) {
    res.status(404).json({ message: "Delivery not found" })
    return
  }
  
  // Get related events
  const events = await foodDistribution.listDeliveryEvents(
    { delivery_id: id },
    { order: { occurred_at: "DESC" }, take: 50 }
  )
  
  res.json({
    delivery: {
      ...delivery,
      events,
    },
  })
}

// ===========================================
// PUT /food-deliveries/:id
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check delivery exists
    const existing = await foodDistribution.retrieveFoodDelivery(id)
    if (!existing) {
      res.status(404).json({ message: "Delivery not found" })
      return
    }
    
    let delivery
    
    // Status update with location
    if (data.status) {
      const location = data.latitude && data.longitude
        ? { latitude: data.latitude, longitude: data.longitude }
        : undefined
      
      delivery = await foodDistribution.updateDeliveryStatus(
        id,
        data.status as DeliveryStatus,
        location,
        data.notes
      )
    } else {
      // Regular update
      const updateData: Record<string, any> = { id }
      
      if (data.has_issue !== undefined) {
        updateData.has_issue = data.has_issue
        updateData.issue_type = data.issue_type
        updateData.issue_description = data.issue_description
        updateData.issue_reported_at = data.has_issue ? new Date() : null
      }
      
      if (data.customer_rating) {
        updateData.customer_rating = data.customer_rating
        updateData.customer_feedback = data.customer_feedback
      }
      
      delivery = await foodDistribution.updateFoodDeliveries(updateData)
    }
    
    res.json({ delivery })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}

// ===========================================
// POST /food-deliveries/:id/proof
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  // Check if this is proof of delivery submission
  if (!req.url?.includes("/proof")) {
    res.status(404).json({ message: "Not found" })
    return
  }
  
  try {
    const data = proofOfDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check delivery exists
    const existing = await foodDistribution.retrieveFoodDelivery(id)
    if (!existing) {
      res.status(404).json({ message: "Delivery not found" })
      return
    }
    
    // Validate PIN if required
    if (existing.proof_type === "PIN_CODE" && data.proof_type === "PIN_CODE") {
      if (data.pin_code !== existing.proof_pin_code) {
        res.status(400).json({ message: "Invalid PIN code" })
        return
      }
    }
    
    const delivery = await foodDistribution.recordProofOfDelivery(id, data.proof_type, {
      photoUrl: data.photo_url,
      signatureUrl: data.signature_url,
      pinCode: data.pin_code,
      recipientName: data.recipient_name,
      notes: data.notes,
    })
    
    res.json({ delivery })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
