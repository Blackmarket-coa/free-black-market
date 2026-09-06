import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"

/**
 * Store API Routes for Order Cycles
 * 
 * Public endpoints for customers to view active order cycles
 * GET /store/order-cycles - List open order cycles
 */

// GET /store/order-cycles
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  
  const { 
    seller_id,
    include_upcoming = "false",
    limit = "20",
    offset = "0",
  } = req.query as {
    seller_id?: string
    include_upcoming?: string
    limit?: string
    offset?: string
  }
  
  const limitNum = parseInt(limit, 10)
  const offsetNum = parseInt(offset, 10)
  
  // Build filters for open cycles
  const filters: Record<string, unknown> = {
    status: include_upcoming === "true" ? ["open", "upcoming"] : ["open"],
  }
  
  // If requesting cycles for a specific seller
  if (seller_id) {
    const sellerCycles = await orderCycleService.listOrderCycleSellers({
      seller_id,
      is_active: true,
    })
    
    // `order_cycle_seller.id` is the membership row, not the cycle; mapping
    // it here made every per-seller listing come back empty (CDFI roadmap §1a).
    const cycleIds = sellerCycles.map((sc) => sc.order_cycle_id)
    
    if (cycleIds.length === 0) {
      return res.json({
        order_cycles: [],
        count: 0,
        limit: limitNum,
        offset: offsetNum,
      })
    }
    
    filters.id = cycleIds
  }
  
  // Get order cycles
  const orderCycles = await orderCycleService.listOrderCycles(filters, {
    take: limitNum,
    skip: offsetNum,
    order: { opens_at: "ASC" },
  })
  
  // For each cycle, get visible products count
  const cyclesWithMeta = await Promise.all(
    orderCycles.map(async (cycle) => {
      const products = await orderCycleService.listOrderCycleProducts({
        order_cycle_id: cycle.id,
        is_visible: true,
      })
      
      const sellers = await orderCycleService.listOrderCycleSellers({
        order_cycle_id: cycle.id,
        is_active: true,
      })
      
      return {
        id: cycle.id,
        name: cycle.name,
        description: cycle.description,
        opens_at: cycle.opens_at,
        closes_at: cycle.closes_at,
        dispatch_at: cycle.dispatch_at,
        status: cycle.status,
        pickup_instructions: cycle.pickup_instructions,
        pickup_location: cycle.pickup_location,
        product_count: products.length,
        seller_count: sellers.length,
      }
    })
  )
  
  res.json({
    order_cycles: cyclesWithMeta,
    count: orderCycles.length,
    limit: limitNum,
    offset: offsetNum,
  })
}
