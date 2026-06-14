import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../modules/order-cycle/service"

/**
 * Store API Route for Single Order Cycle
 * 
 * GET /store/order-cycles/:id - Get order cycle with products
 */

// GET /store/order-cycles/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params
  
  try {
    const orderCycle = await orderCycleService.retrieveOrderCycle(id)
    
    // Only show open or upcoming cycles to customers
    if (!["open", "upcoming"].includes(orderCycle.status)) {
      return res.status(404).json({ message: "Order cycle not found" })
    }
    
    // Get visible products with variant details
    const cycleProducts = await orderCycleService.listOrderCycleProducts({
      order_cycle_id: id,
      is_visible: true,
    }, {
      order: { display_order: "ASC" },
    })
    
    // Fetch full product/variant details via Query
    const variantIds = cycleProducts.map((cp) => cp.variant_id)
    
    let productsWithDetails: Array<{
      id: string
      variant_id: string
      effective_price: number | null
      available_quantity: number | null
      has_override_price: boolean
      display_order: number
      variant: unknown
    }> = []
    
    if (variantIds.length > 0) {
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: [
          "id",
          "title",
          "sku",
          "prices.*",
          "product.id",
          "product.title",
          "product.description",
          "product.thumbnail",
          "product.handle",
        ],
        filters: {
          id: variantIds,
        },
      })
      
      // Merge cycle product data with variant data
      productsWithDetails = cycleProducts.map((cp) => {
        const variant = variants.find((v: { id: string }) => v.id === cp.variant_id)
        
        // Calculate effective price (cycle override or variant price)
        let effectivePrice = cp.override_price
        // In Medusa v2, prices are accessed via calculated_price, not prices array
        const variantWithPrices = variant as typeof variant & { prices?: Array<{ amount: number }> }
        if (!effectivePrice && variantWithPrices?.prices && variantWithPrices.prices.length > 0) {
          effectivePrice = variantWithPrices.prices[0].amount
        }
        
        // Calculate remaining quantity
        const remainingQuantity = cp.available_quantity !== null
          ? cp.available_quantity - cp.sold_quantity
          : null
        
        return {
          id: cp.id,
          variant_id: cp.variant_id,
          effective_price: effectivePrice,
          available_quantity: remainingQuantity,
          has_override_price: cp.override_price !== null,
          display_order: cp.display_order,
          variant,
        }
      })
    }
    
    // Get sellers in this cycle
    const cycleSellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: id,
      is_active: true,
    })
    
    const now = Date.now()
    
    res.json({
      order_cycle: {
        id: orderCycle.id,
        name: orderCycle.name,
        description: orderCycle.description,
        opens_at: orderCycle.opens_at,
        closes_at: orderCycle.closes_at,
        dispatch_at: orderCycle.dispatch_at,
        status: orderCycle.status,
        pickup_instructions: orderCycle.pickup_instructions,
        pickup_location: orderCycle.pickup_location,
        // Time helpers for frontend
        is_open: orderCycle.status === "open",
        time_until_close: orderCycle.status === "open" 
          ? new Date(orderCycle.closes_at).getTime() - now
          : null,
        time_until_open: orderCycle.status === "upcoming"
          ? new Date(orderCycle.opens_at).getTime() - now
          : null,
      },
      products: productsWithDetails,
      seller_count: cycleSellers.length,
    })
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}

