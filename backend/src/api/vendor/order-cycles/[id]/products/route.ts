import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../../types"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"

/**
 * Vendor API Routes for Order Cycle Products
 * 
 * GET /vendor/order-cycles/:id/products - List products in cycle
 * POST /vendor/order-cycles/:id/products - Add product to cycle
 */

// GET /vendor/order-cycles/:id/products
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  const { id } = req.params
  
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  
  try {
    // Check access
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    const sellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: id,
    })
    
    const hasAccess = sellers.some(
      (s) => s.seller_id === sellerId && s.is_active
    ) || orderCycle.coordinator_seller_id === sellerId
    
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" })
    }
    
    // Get products - filter by seller unless coordinator
    const isCoordinator = orderCycle.coordinator_seller_id === sellerId
    
    const filters: Record<string, unknown> = {
      order_cycle_id: id,
    }
    
    if (!isCoordinator) {
      // Non-coordinators only see their own products
      filters.seller_id = sellerId
    }
    
    const products = await orderCycleService.listOrderCycleProducts(filters, {
      order: { display_order: "ASC" },
    })
    
    res.json({ products })
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}

// POST /vendor/order-cycles/:id/products
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  const { id } = req.params
  
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  
  const {
    variant_id,
    available_quantity,
    override_price,
    is_visible,
    display_order,
  } = req.body as {
    variant_id: string
    available_quantity?: number
    override_price?: number
    is_visible?: boolean
    display_order?: number
  }
  
  if (!variant_id) {
    return res.status(400).json({ message: "variant_id is required" })
  }
  
  try {
    // Check access
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    const sellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: id,
    })
    
    const hasAccess = sellers.some(
      (s) => s.seller_id === sellerId && s.is_active
    ) || orderCycle.coordinator_seller_id === sellerId
    
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" })
    }
    
    // Check cycle is editable (not dispatched or cancelled)
    if (["dispatched", "cancelled"].includes(orderCycle.status)) {
      return res.status(400).json({ 
        message: "Cannot add products to a dispatched or cancelled order cycle" 
      })
    }
    
    // Add product to cycle
    const product = await orderCycleService.addProductToOrderCycle(
      id,
      variant_id,
      sellerId,
      {
        available_quantity,
        override_price,
        is_visible: is_visible ?? true,
        display_order: display_order ?? 0,
      }
    )
    
    res.status(201).json({ product })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(400).json({ message })
  }
}

