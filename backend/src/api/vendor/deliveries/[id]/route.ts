import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { requireSellerId, type StatusHistoryEntry } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"
import { retrieveDeliveryOrNull } from "../../../../modules/food-distribution/proof-of-delivery"
import { redactDelivery } from "../../../../modules/food-distribution/public-view"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateDeliveryStatusSchema = z.object({
  status: z.enum([
    "ASSIGNED",
    "WAITING_FOR_ORDER",
    "ORDER_PICKED_UP",
    "CANCELLED",
  ]),
  note: z.string().max(500).optional(),
})

// ===========================================
// GET /vendor/deliveries/:id
// Get a single delivery detail
//
// A delivery that does not exist and another store's delivery are refused
// alike, with `forbidden()`, on this GET and on the POST below (SD-107). Read
// bare, the lookup threw for a missing id, so any seller with a producer
// profile got 404 for a missing delivery and 403 "This delivery does not
// belong to your store" for a real one.
//
// Both verbs, and the list next door, serve the delivery without its proof
// PIN (`redactDelivery`), as every /store delivery response does.
// ===========================================

export async function GET(
  req: AuthenticatedMedusaRequest<never, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Find the food producer linked to this seller via seller_id on food_producer
    const producers = await foodDistribution.listFoodProducers(
      { seller_id: sellerId },
      { select: ["id"], take: 1 }
    )

    if (!producers.length) {
      res.status(404).json({ message: "No producer profile linked to this seller" })
      return
    }

    const producerId = producers[0].id

    // The delivery, when it is this vendor's producer's. Missing and another
    // store's are refused alike.
    const delivery = await retrieveDeliveryOrNull(foodDistribution, id)
    if (!delivery || delivery.producer_id !== producerId) {
      forbidden(res)
      return
    }

    res.json({ delivery: redactDelivery(delivery as unknown as Record<string, unknown>) })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /vendor/deliveries/:id
// Update delivery status (vendor actions)
// ===========================================

export async function POST(
  req: AuthenticatedMedusaRequest<{ status: string; note?: string }, { id: string }>,
  res: MedusaResponse
) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const { id } = req.params
    const data = updateDeliveryStatusSchema.parse(req.body)

    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)

    // Find the food producer linked to this seller via seller_id on food_producer
    const producers = await foodDistribution.listFoodProducers(
      { seller_id: sellerId },
      { select: ["id"], take: 1 }
    )

    if (!producers.length) {
      res.status(404).json({ message: "No producer profile linked to this seller" })
      return
    }

    const producerId = producers[0].id

    // The delivery, when it is this vendor's producer's. Missing and another
    // store's are refused alike.
    const delivery = await retrieveDeliveryOrNull(foodDistribution, id)
    if (!delivery || delivery.producer_id !== producerId) {
      forbidden(res)
      return
    }

    // Update status history
    const existingHistory = (delivery.status_history || []) as StatusHistoryEntry[]
    const statusHistory: StatusHistoryEntry[] = [
      ...existingHistory,
      {
        status: data.status,
        timestamp: new Date().toISOString(),
        note: data.note,
        actor: "vendor",
      }
    ]

    // Update the delivery
    const updatedDelivery = await foodDistribution.updateFoodDeliveries({
      selector: { id },
      data: {
        status: data.status as any,
        status_history: statusHistory as any,
      },
    })

    // The selector form of the update answers with a list; the response keeps
    // that shape and loses the PIN.
    const updated = updatedDelivery as unknown as
      | Record<string, unknown>
      | Record<string, unknown>[]
    res.json({
      delivery: Array.isArray(updated) ? updated.map(redactDelivery) : redactDelivery(updated),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
