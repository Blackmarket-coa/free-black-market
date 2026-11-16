import { z } from "zod"
import {
  actorMayReadDelivery,
  actorOwnsCourier,
  actorOwnsProducer,
  forbidden,
} from "../../../../shared/community-read-access"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { DeliveryStatus } from "../../../../modules/food-distribution/models/delivery"
import { redactDelivery } from "../../../../modules/food-distribution/public-view"
import {
  DELIVERED_STATUSES,
  proofRequirementLabel,
  requiresProof,
  retrieveDeliveryOrNull,
} from "../../../../modules/food-distribution/proof-of-delivery"
import { POST as submitProofOfDelivery } from "./proof/route"

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

/**
 * What a producer may set on its own delivery: the same set
 * `/vendor/deliveries/:id` allows (`updateDeliveryStatusSchema` there). The
 * rest of the lifecycle, including arriving at the destination and every
 * delivered status, is the courier's.
 */
const PRODUCER_STATUSES: ReadonlySet<string> = new Set([
  "ASSIGNED",
  "WAITING_FOR_ORDER",
  "ORDER_PICKED_UP",
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

// ===========================================
// GET /food-deliveries/:id
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const delivery = await foodDistribution.retrieveFoodDelivery(id)

  // Producer, courier or recipient only (D10-5). Same refusal for a missing
  // delivery as for someone else's, because ids are enumerable.
  if (!delivery || !(await actorMayReadDelivery(req, delivery))) {
    return forbidden(res)
  }
  
  // Get related events
  const events = await foodDistribution.listDeliveryEvents(
    { delivery_id: id },
    { order: { occurred_at: "DESC" }, take: 50 }
  )
  
  res.json({
    delivery: {
      ...redactDelivery(delivery as unknown as Record<string, unknown>),
      events,
    },
  })
}

// ===========================================
// PUT /food-deliveries/:id
//
// The delivery's principals only, each for their own part:
//   - status / location: its courier; its producer only the hand-over
//     statuses (PRODUCER_STATUSES) and no location;
//   - customer_rating / customer_feedback: its recipient;
//   - issue reporting: any of the three.
// A delivery that does not exist is refused the same way as someone else's.
// And a delivery created with a proof requirement cannot be put into a
// delivered status here at all: that is what POST /:id/proof is for, and
// setting DELIVERED here would skip the proof (and the PIN) entirely.
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = updateDeliverySchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const existing = await retrieveDeliveryOrNull(foodDistribution, id)
    if (!existing || !(await actorMayReadDelivery(req, existing))) {
      return forbidden(res)
    }

    const isCourier = await actorOwnsCourier(req, existing.courier_id)
    const isProducer =
      !isCourier && (await actorOwnsProducer(req, existing.producer_id))
    const runsDelivery = isCourier || isProducer
    // actorMayReadDelivery admits producer, courier or recipient, so a
    // principal who runs neither side of it is the recipient.
    const isRecipient = !runsDelivery

    if (data.status && !runsDelivery) {
      return forbidden(res)
    }
    // The producer hands the order over; the courier carries it. A producer
    // gets the same status set /vendor/deliveries/:id allows it, and no
    // location writes: the position on a delivery is the courier's, and the
    // recipient tracks it.
    if (isProducer) {
      if (data.status && !PRODUCER_STATUSES.has(data.status)) {
        return forbidden(res)
      }
      if (data.latitude !== undefined || data.longitude !== undefined) {
        return forbidden(res)
      }
    }
    if (data.customer_rating !== undefined && !isRecipient) {
      return forbidden(res)
    }
    if (
      data.status &&
      DELIVERED_STATUSES.has(data.status) &&
      requiresProof(existing)
    ) {
      res.status(409).json({
        message: `This delivery requires ${proofRequirementLabel(existing.proof_type)}; submit it to /proof`,
      })
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
    
    // Redacted like GET: a courier must not read the PIN it is meant to be
    // told by the recipient off its own location update.
    res.json({
      delivery: redactDelivery(delivery as unknown as Record<string, unknown>),
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
// POST /food-deliveries/:id/proof
//
// Only reachable when the URL contains "/proof" without routing to
// ./proof/route.ts, which a query string does (`POST /:id?x=/proof`). It used
// to carry its own copy of the proof handler without that file's state check,
// and with the same PIN bypass; it now is that handler.
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!req.url?.includes("/proof")) {
    res.status(404).json({ message: "Not found" })
    return
  }
  return submitProofOfDelivery(req, res)
}
