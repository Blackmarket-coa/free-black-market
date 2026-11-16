import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../modules/food-distribution/service"
import {
  deliveryCompletedDescription,
  proofOfDeliveryError,
  retrieveDeliveryOrNull,
} from "../../../../../modules/food-distribution/proof-of-delivery"
import { redactDelivery } from "../../../../../modules/food-distribution/public-view"
import {
  actorOwnsCourier,
  forbidden,
} from "../../../../../shared/community-read-access"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const proofOfDeliverySchema = z.object({
  proof_type: z.enum(["SIGNATURE", "PHOTO", "PIN_CODE", "RECIPIENT_CONFIRMATION"]),
  // Further restricted to this platform's own file storage by
  // `proofOfDeliveryError`; `.url()` alone accepts `javascript:` and `data:`.
  photo_url: z.string().max(2048).url().optional(),
  signature_url: z.string().max(2048).url().optional(),
  pin_code: z.string().max(10).optional(),
  recipient_name: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
})

// ===========================================
// POST /food-deliveries/:id/proof
// Submit proof of delivery
//
// The delivery's courier only: proof of delivery is the courier's statement
// that they handed the goods over, and it closes the delivery and frees the
// courier. A delivery that does not exist is refused the same way as one the
// caller is not driving. A delivery created with a proof requirement accepts
// only that proof, and a PIN requirement only the PIN on record
// (`proofOfDeliveryError`); before this, submitting PHOTO skipped the PIN.
// On any delivery, including one created with no requirement, the named
// type needs its evidence: PIN_CODE the PIN on record, PHOTO a photo, and so
// on, because the type is what the 200 and the saved event name.
// Only the PIN is proof the courier cannot make up: PHOTO and SIGNATURE (a
// file in this platform's storage) and RECIPIENT_CONFIRMATION (a typed name)
// are the courier's attestation, accepted as such and not verified. The 200
// says so too (`deliveryCompletedDescription`, the same text as the saved
// delivery event); it used to read "Proof of delivery recorded successfully"
// whatever the type.
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = proofOfDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const delivery = await retrieveDeliveryOrNull(foodDistribution, id)
    if (!delivery || !(await actorOwnsCourier(req, delivery.courier_id))) {
      return forbidden(res)
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
    
    const proofError = proofOfDeliveryError(delivery, data)
    if (proofError) {
      res.status(400).json({ message: proofError })
      return
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
      delivery: redactDelivery(updatedDelivery as unknown as Record<string, unknown>),
      message: deliveryCompletedDescription(data.proof_type),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
