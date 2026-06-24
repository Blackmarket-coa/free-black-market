import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../../../../types"
import OrderCycleModuleService from "../../../../../../../modules/order-cycle/service"

interface AddProductsBody {
  products: Array<{
    variant_id: string
    available_quantity?: number
    override_price?: number
  }>
}

// GET /vendor/order-cycles/:id/exchanges/:exchangeId/products
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { exchangeId } = req.params
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const products = await orderCycleService.listOrderCycleProducts({
      exchange_id: exchangeId,
    })
    res.json({ products })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message })
  }
}

// POST /vendor/order-cycles/:id/exchanges/:exchangeId/products
export const POST = async (req: MedusaRequest<AddProductsBody>, res: MedusaResponse) => {
  const { id, exchangeId } = req.params
  const { products } = req.body
  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  try {
    const exchange = await orderCycleService.retrieveOrderCycleExchange(exchangeId)
    
    const createdProducts: unknown[] = []
    for (const product of products) {
      const created = await orderCycleService.createOrderCycleProducts({
        order_cycle_id: id,
        exchange_id: exchangeId,
        variant_id: product.variant_id,
        seller_id: exchange.seller_id || sellerId,
        available_quantity: product.available_quantity,
        override_price: product.override_price,
      })
      createdProducts.push(created)
    }

    res.status(201).json({ products: createdProducts })
  } catch (error) {
    res.status(500).json({ message: "Failed to add products", error: error.message })
  }
}
