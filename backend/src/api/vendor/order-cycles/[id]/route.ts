import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../modules/order-cycle/service"

/**
 * Vendor API Routes for Single Order Cycle
 * 
 * GET /vendor/order-cycles/:id - Get order cycle details
 * PUT /vendor/order-cycles/:id - Update order cycle
 * DELETE /vendor/order-cycles/:id - Delete order cycle
 */

// GET /vendor/order-cycles/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = (req as any).auth_context?.actor_id
  const { id } = req.params
  
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  
  try {
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    // Get sellers for access check
    const sellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: id,
    })
    
    // Check seller has access
    const hasAccess = sellers.some(
      (s) => s.seller_id === sellerId && s.is_active
    ) || orderCycle.coordinator_seller_id === sellerId
    
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" })
    }
    
    // Get products
    const products = await orderCycleService.listOrderCycleProducts({
      order_cycle_id: id,
    })
    
    res.json({ 
      order_cycle: {
        ...orderCycle,
        products,
        sellers,
      }
    })
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}

// PUT /vendor/order-cycles/:id
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = (req as any).auth_context?.actor_id
  const { id } = req.params
  
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  
  try {
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    // Only coordinator can update
    if (orderCycle.coordinator_seller_id !== sellerId) {
      return res.status(403).json({ 
        message: "Only the coordinator can update this order cycle" 
      })
    }
    
    const body = req.body as Record<string, unknown>
    
    const updates: Record<string, unknown> = { id }
    
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.opens_at !== undefined) updates.opens_at = new Date(body.opens_at as string)
    if (body.closes_at !== undefined) updates.closes_at = new Date(body.closes_at as string)
    if (body.dispatch_at !== undefined) updates.dispatch_at = new Date(body.dispatch_at as string)
    if (body.status !== undefined) updates.status = body.status
    if (body.pickup_instructions !== undefined) updates.pickup_instructions = body.pickup_instructions
    if (body.pickup_location !== undefined) updates.pickup_location = body.pickup_location
    if (body.is_recurring !== undefined) updates.is_recurring = body.is_recurring
    if (body.recurrence_rule !== undefined) updates.recurrence_rule = body.recurrence_rule
    
    const updated = await orderCycleService.updateOrderCycles(updates)
    
    res.json({ order_cycle: updated })
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}

// DELETE /vendor/order-cycles/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = (req as any).auth_context?.actor_id
  const { id } = req.params
  
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  
  try {
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    // Only coordinator can delete
    if (orderCycle.coordinator_seller_id !== sellerId) {
      return res.status(403).json({ 
        message: "Only the coordinator can delete this order cycle" 
      })
    }
    
    // Don't allow deletion of cycles with orders (soft delete instead)
    // For now, just mark as cancelled
    if (orderCycle.status === "open" || orderCycle.status === "closed") {
      await orderCycleService.updateOrderCycles({ id, status: "cancelled" })
      res.json({ 
        message: "Order cycle cancelled (had active orders)",
        order_cycle: { ...orderCycle, status: "cancelled" },
      })
    } else {
      await orderCycleService.deleteOrderCycles(id)
      res.json({ message: "Order cycle deleted" })
    }
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}
