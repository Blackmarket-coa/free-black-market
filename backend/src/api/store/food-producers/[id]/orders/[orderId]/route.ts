import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../../modules/food-distribution/service"
import { DeliveryStatus } from "../../../../../../modules/food-distribution/models/delivery"
import { actorMayManage } from "../../../../../../shared/actor-scope"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateProducerSchema = z.object({
  // Producer-facing order status updates
  status: z.enum([
    "CONFIRMED",      // Producer confirmed the order
    "PREPARING",      // Producer started preparation
    "READY",          // Order ready for pickup
    "CANCELLED",      // Producer cancelled order
  ]).optional(),
  
  // Preparation timing
  estimated_ready_at: z.string().datetime().optional(),
  actual_ready_at: z.string().datetime().optional(),
  
  // For trades
  trade_accepted: z.boolean().optional(),
  trade_counter_offer: z.string().max(500).optional(),
  
  // Notes
  producer_notes: z.string().max(500).optional(),
})

// ===========================================
// GET /food-producers/:id/orders/:orderId
// Get order details for producer
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: producerId, orderId } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Verify producer
  const producer = await foodDistribution.retrieveFoodProducer(producerId)
  if (!producer) {
    res.status(404).json({ message: "Producer not found" })
    return
  }
  
  // Get order
  const order = await foodDistribution.retrieveFoodOrder(orderId)
  if (!order) {
    res.status(404).json({ message: "Order not found" })
    return
  }
  
  // Verify order belongs to producer
  if (order.producer_id !== producerId) {
    res.status(403).json({ message: "Order does not belong to this producer" })
    return
  }
  
  // Get order items
  const items = await foodDistribution.listFoodOrderItems({ order_id: orderId })
  
  // Get delivery if exists
  const deliveries = await foodDistribution.listFoodDeliveries({ order_id: orderId })
  const delivery = deliveries[0] || null
  
  res.json({
    order: {
      ...order,
      items,
      delivery,
    },
  })
}

// ===========================================
// PUT /food-producers/:id/orders/:orderId
// Update order (producer actions)
// ===========================================

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id: producerId, orderId } = req.params
  
  try {
    const data = updateProducerSchema.parse(req.body)
    
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Verify producer
    const producer = await foodDistribution.retrieveFoodProducer(producerId)
    if (!producer) {
      res.status(404).json({ message: "Producer not found" })
      return
    }
    // Only the producer's owner may act on its orders (confirm / cancel / ready).
    if (!actorMayManage(req, (producer as any).owner_id)) {
      res.status(403).json({ message: "This producer is not yours to manage" })
      return
    }

    // Get order
    const order = await foodDistribution.retrieveFoodOrder(orderId)
    if (!order) {
      res.status(404).json({ message: "Order not found" })
      return
    }
    
    // Verify order belongs to producer
    if (order.producer_id !== producerId) {
      res.status(403).json({ message: "Order does not belong to this producer" })
      return
    }
    
    // Build update
    const updateData: Record<string, any> = { id: orderId }
    
    if (data.status) {
      // Validate status transitions
      const validTransitions: Record<string, string[]> = {
        PENDING: ["CONFIRMED", "CANCELLED"],
        CONFIRMED: ["PREPARING", "CANCELLED"],
        PREPARING: ["READY", "CANCELLED"],
      }
      
      const allowed = validTransitions[order.status] || []
      if (!allowed.includes(data.status)) {
        res.status(400).json({ 
          message: `Cannot transition from ${order.status} to ${data.status}` 
        })
        return
      }
      
      updateData.status = data.status
      
      if (data.status === "CONFIRMED") {
        updateData.confirmed_at = new Date()
      } else if (data.status === "PREPARING") {
        updateData.preparation_started_at = new Date()
      } else if (data.status === "READY") {
        updateData.ready_at = new Date()
      } else if (data.status === "CANCELLED") {
        updateData.cancelled_at = new Date()
      }
    }
    
    if (data.estimated_ready_at) {
      updateData.estimated_ready_at = new Date(data.estimated_ready_at)
    }
    
    if (data.actual_ready_at) {
      updateData.actual_ready_at = new Date(data.actual_ready_at)
    }
    
    if (data.producer_notes !== undefined) {
      updateData.producer_notes = data.producer_notes
    }
    
    // Handle trade responses
    if (order.transaction_type === "TRADE") {
      if (data.trade_accepted !== undefined) {
        updateData.trade_accepted = data.trade_accepted
        updateData.trade_responded_at = new Date()
      }
      if (data.trade_counter_offer) {
        updateData.trade_counter_offer = data.trade_counter_offer
      }
    }
    
    const updatedOrder = await foodDistribution.updateFoodOrders(updateData)
    
    // If order is ready, update delivery status
    if (data.status === "READY") {
      const deliveries = await foodDistribution.listFoodDeliveries({ order_id: orderId })
      if (deliveries.length > 0) {
        await foodDistribution.updateDeliveryStatus(
          deliveries[0].id,
          DeliveryStatus.WAITING_FOR_ORDER,
          undefined,
          "Order is ready for pickup"
        )
      }
    }
    
    res.json({ order: updatedOrder })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
