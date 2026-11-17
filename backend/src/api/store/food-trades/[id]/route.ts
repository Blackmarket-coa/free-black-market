import { z } from "zod"
import {
  actorIsAnyOf,
  actorOwnsProducer,
  forbidden,
} from "../../../../shared/community-read-access"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"
import { applyRecipientAnonymity } from "../../../../modules/food-distribution/public-view"
import { nullIfNotFound } from "../../../../shared/null-if-not-found"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const respondToTradeSchema = z.object({
  accepted: z.boolean(),
  counter_offer: z.string().max(1000).optional(),
  producer_notes: z.string().max(500).optional(),
})

// ===========================================
// GET /food-trades/:id
//
// The producer running the trade, or the customer on it (D10-5). Everyone
// else is refused, and refused the same way whether the id names a trade,
// another kind of order or nothing at all. This read needs no sign-in to be
// attempted, and it used to give three answers: 404 for an id that does not
// exist (the bare `retrieveFoodOrder` throws; it never returned the null the
// old `!order` check was written for), 400 for an order that is not a trade,
// 403 for a trade. Together they told anyone which order ids exist and of
// which kind. The type check now comes after the principal check, as in POST
// below, so only a principal of the order learns it is not a trade.
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const order = await nullIfNotFound(foodDistribution.retrieveFoodOrder(id))

  if (
    !order ||
    (!(await actorOwnsProducer(req, order.producer_id)) &&
      !actorIsAnyOf(req, order.customer_id))
  ) {
    return forbidden(res)
  }

  if (order.transaction_type !== "TRADE") {
    res.status(400).json({ message: "Order is not a trade" })
    return
  }
  
  // Get related data
  const [producer, items] = await Promise.all([
    foodDistribution.retrieveFoodProducer(order.producer_id),
    foodDistribution.listFoodOrderItems({ order_id: id }),
  ])
  
  res.json({
    trade: {
      ...applyRecipientAnonymity(order as unknown as Record<string, unknown>),
      producer: producer ? {
        id: producer.id,
        name: producer.name,
        producer_type: producer.producer_type,
      } : null,
      items,
      trade_offer_items: (order.metadata as any)?.trade_offer_items || [],
    },
  })
}

// ===========================================
// POST /food-trades/:id/respond
// Producer responds to trade offer
//
// The producer the trade was offered to, and nobody else. Accepting confirms
// the order and declining cancels it, so before this any signed-in account
// could settle any producer's pending trade. A trade that does not exist is
// refused the same way as someone else's (ids are enumerable).
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = respondToTradeSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const order = await nullIfNotFound(foodDistribution.retrieveFoodOrder(id))
    
    if (!order || !(await actorOwnsProducer(req, order.producer_id))) {
      return forbidden(res)
    }
    
    if (order.transaction_type !== "TRADE") {
      res.status(400).json({ message: "Order is not a trade" })
      return
    }
    
    if (order.status !== "PENDING") {
      res.status(400).json({ message: "Trade has already been responded to" })
      return
    }
    
    const updateData: Record<string, any> = {
      id,
      trade_accepted: data.accepted,
      trade_responded_at: new Date(),
      producer_notes: data.producer_notes,
    }
    
    if (data.accepted) {
      updateData.status = "CONFIRMED"
      updateData.confirmed_at = new Date()
    } else {
      updateData.status = "CANCELLED"
      updateData.cancelled_at = new Date()
      if (data.counter_offer) {
        updateData.trade_counter_offer = data.counter_offer
      }
    }
    
    const updatedOrder = await foodDistribution.updateFoodOrders(updateData)
    
    res.json({
      trade: updatedOrder,
      message: data.accepted ? "Trade accepted" : "Trade declined",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
