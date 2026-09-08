import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import OrderCycleModuleService from "../../../../../../../modules/order-cycle/service"
import { resolveExchangeAccess } from "../../../../_access"

interface AddProductsBody {
  products: Array<{
    variant_id: string
    available_quantity?: number
    override_price?: number
  }>
}

/**
 * Products on one exchange of an order cycle.
 *
 * Both handlers ran with only the generic `/vendor/**` seller authentication
 * until 2026-09-08: every sibling under `order-cycles/[id]` gated on
 * `resolveCycleAccess`, this one on nothing. Any authenticated seller could
 * list another coordinator's exchange products, and POST wrote
 * `order_cycle_id` straight from the path without checking the exchange
 * belonged to it — so a guessed `:id`/`:exchangeId` pair inserted rows into a
 * stranger's cycle. `resolveExchangeAccess` is the same gate the parent
 * exchange route already used.
 */

// GET /vendor/order-cycles/:id/exchanges/:exchangeId/products
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const loaded = await resolveExchangeAccess(req, res, false)
  if (!loaded) return

  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")

  try {
    const products = await orderCycleService.listOrderCycleProducts({
      exchange_id: loaded.exchange.id,
    })
    res.json({ products })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message })
  }
}

// POST /vendor/order-cycles/:id/exchanges/:exchangeId/products
export const POST = async (req: MedusaRequest<AddProductsBody>, res: MedusaResponse) => {
  const loaded = await resolveExchangeAccess(req, res, true)
  if (!loaded) return

  const { products } = req.body
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ message: "products must be a non-empty array" })
  }

  const orderCycleService: OrderCycleModuleService = req.scope.resolve("orderCycleModuleService")
  const { access, exchange } = loaded

  try {
    // The service upserts on (cycle, variant) and takes the cycle id from the
    // exchange itself. Re-implementing it here always inserted, so adding a
    // variant already in the cycle tripped the unique index and 500'd.
    const created = await orderCycleService.addProductsToExchange(
      exchange.id,
      products.map((product) => ({
        variant_id: product.variant_id,
        seller_id: exchange.seller_id || access.sellerId,
        available_quantity: product.available_quantity,
        override_price: product.override_price,
      }))
    )

    res.status(201).json({ products: created })
  } catch (error) {
    res.status(500).json({ message: "Failed to add products", error: error.message })
  }
}
