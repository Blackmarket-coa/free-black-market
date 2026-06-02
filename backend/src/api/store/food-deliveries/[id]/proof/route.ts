import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const proofOfDeliverySchema = z.object({
  proof_type: z.enum(["SIGNATURE", "PHOTO", "PIN_CODE", "RECIPIENT_CONFIRMATION"]),
  photo_url: z.string().url().optional(),
  signature_url: z.string().url().optional(),
  pin_code: z.string().max(10).optional(),
  recipient_name: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
})

// ===========================================
// POST /food-deliveries/:id/proof
// Submit proof of delivery
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = proofOfDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Check delivery exists
    const delivery = await foodDistribution.retrieveFoodDelivery(id)
    if (!delivery) {
      res.status(404).json({ message: "Delivery not found" })
      return
    }
    
    // Check delivery is in correct state
    const validStates = ["ARRIVED_AT_DESTINATION", "ATTEMPTING_DELIVERY"]
    if (!validStates.includes(delivery.status)) {
      res.status(400).json({ 
        message: "Delivery is not in a state to accept proof",
        current_status: delivery.status,
      })
      return
    }
    
    // Validate PIN if required
    if (delivery.proof_type === "PIN_CODE" && data.proof_type === "PIN_CODE") {
      if (data.pin_code !== delivery.proof_pin_code) {
        res.status(400).json({ message: "Invalid PIN code" })
        return
      }
    }
    
    // Record proof of delivery
    const updatedDelivery = await foodDistribution.recordProofOfDelivery(id, data.proof_type, {
      photoUrl: data.photo_url,
      signatureUrl: data.signature_url,
      pinCode: data.pin_code,
      recipientName: data.recipient_name,
      notes: data.notes,
    })
    
    // Track final location if provided
    if (data.latitude && data.longitude) {
      await foodDistribution.trackCourierLocation(id, data.latitude, data.longitude)
    }
    
    res.json({ 
      delivery: updatedDelivery,
      message: "Proof of delivery recorded successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
