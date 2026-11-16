import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../../../modules/food-distribution/service"
import { DeliveryStatus } from "../../../../../../modules/food-distribution/models/delivery"
import { actorMayManage, actorOwnsResource } from "../../../../../../shared/actor-scope"
import { forbidden } from "../../../../../../shared/community-read-access"
import { nullIfNotFound } from "../../../../../../shared/null-if-not-found"

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

/**
 * Owner-only (SEC-2 residual). `api/middlewares.ts` gates the
 * `/store/food-producers` prefix on write verbs only, so this GET is
 * unauthenticated, and it returned the whole `food_order` — recipient name,
 * phone, email and delivery address — plus its items and delivery to anyone
 * who could name a producer id (public, from `GET /store/food-producers`) and
 * an order id. The list route was closed under D10-1; this sibling was not.
 *
 * Ownership is checked before the order is looked up, so a non-owner cannot
 * learn which order ids exist, and with `actorOwnsResource` (no grandfathering
 * of a null `owner_id`), as the list route does, because this is a PII read.
 * Refusals use `forbidden()`: 403 for "not signed in" and "not yours" alike.
 *
 * The owner of one producer is a stranger to every other producer's orders,
 * and any account can own a producer. For them an order id that does not
 * exist used to answer 404 (the bare `retrieveFoodOrder` throws) and another
 * producer's order 403 "Order does not belong to this producer", which told
 * them which order ids exist. Both are now the one `forbidden()`. A producer
 * that does not exist keeps its 404: producers are a public catalogue
 * (`GET /store/food-producers`), so that says nothing new.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: producerId, orderId } = req.params
  
  const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
  
  // Verify producer
  const producer = await foodDistribution.retrieveFoodProducer(producerId)
  if (!producer) {
    res.status(404).json({ message: "Producer not found" })
    return
  }

  if (!actorOwnsResource(req, (producer as { owner_id?: string | null }).owner_id)) {
    forbidden(res)
    return
  }
  
  // The order, when it is this producer's. Missing and another producer's
  // are refused alike.
  const order = await nullIfNotFound(foodDistribution.retrieveFoodOrder(orderId))
  if (!order || order.producer_id !== producerId) {
    forbidden(res)
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
