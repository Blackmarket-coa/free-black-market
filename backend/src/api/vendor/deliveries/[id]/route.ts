import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { DeliveryStatus } from "../../../../modules/food-distribution/models/delivery"
import { requireSellerId } from "../../../../shared"
import { forbidden } from "../../../../shared/community-read-access"
import { retrieveDeliveryOrNull } from "../../../../modules/food-distribution/proof-of-delivery"
import { redactDelivery } from "../../../../modules/food-distribution/public-view"
import { withStatusHistoryList } from "../../../../modules/food-distribution/status-history"

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
// PIN (`redactDelivery`), as every /store delivery response does, and with
// its status history as the list the vendor panel reads
// (`withStatusHistoryList`; the column holds `{ entries }`).
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

    res.json({
      delivery: withStatusHistoryList(redactDelivery(delivery as unknown as Record<string, unknown>)),
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /vendor/deliveries/:id
// Update delivery status (vendor actions)
//
// Through the service's `updateDeliveryStatus`, as every other status change
// is (the producer's own hand-over statuses on `PUT /store/food-deliveries/:id`
// among them). This handler used to append to `status_history` itself, as a
// bare list, while the service stores `{ entries }` (SD-119 (1)): it answered
// 500 "existingHistory is not iterable" for every delivery the service had
// created, which is every delivery `POST /store/food-deliveries` makes, so
// the vendor panel's status buttons did nothing; and on a delivery with no
// history it wrote a list that broke the service's next update of that row.
// Going through the service also stamps the time the status stands for
// (`picked_up_at`) and saves the event, neither of which the copy did.
//
// The 200 carries the delivery as an object, as the panel's hook types it
// (`{ delivery: Delivery }`). It was a one-element list, an accident of the
// selector form of the update the copy used; nothing reads it.
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

    const updated = await foodDistribution.updateDeliveryStatus(
      id,
      DeliveryStatus[data.status],
      undefined,
      data.note,
      { actor: "vendor", actor_type: "PRODUCER", actor_id: sellerId }
    )

    res.json({
      delivery: withStatusHistoryList(redactDelivery(updated as unknown as Record<string, unknown>)),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
