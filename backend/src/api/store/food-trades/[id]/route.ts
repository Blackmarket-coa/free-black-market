import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"

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
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  const order = await foodDistribution.retrieveFoodOrder(id)
  
  if (!order) {
    res.status(404).json({ message: "Trade not found" })
    return
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
      ...order,
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
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  
  try {
    const data = respondToTradeSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    const order = await foodDistribution.retrieveFoodOrder(id)
    
    if (!order) {
      res.status(404).json({ message: "Trade not found" })
      return
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
