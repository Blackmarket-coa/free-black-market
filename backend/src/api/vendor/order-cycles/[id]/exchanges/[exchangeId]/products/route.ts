import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../../modules/order-cycle/service"
import { forbidden } from "../../../../../../../shared/community-read-access"
import { createLogger } from "../../../../../../../shared/logger"
import { parseRouteInput, routeFailure } from "../../../../../../../shared/route-input"
import {
  addExchangeProductsBody,
  cycleRowsHeldByOthers,
  resolveExchangeAccess,
  saveOwnCycleProduct,
  storeOwnsVariants,
} from "../../../../_access"

const log = createLogger("api/vendor/order-cycles/[id]/exchanges/[exchangeId]/products")

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

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const products = await orderCycleService.listOrderCycleProducts({
      exchange_id: loaded.exchange.id,
    })
    res.json({ products })
  } catch (error) {
    routeFailure(log, req, res, "Failed to fetch products", error)
  }
}

/**
 * POST /vendor/order-cycles/:id/exchanges/:exchangeId/products — put the
 * store's own variants on its own exchange.
 *
 * Every row this writes belongs to the exchange's seller, so the exchange must
 * be the caller's: the coordinator may still edit or remove a participant's
 * exchange itself (`resolveExchangeAccess`), but not write rows in the
 * participant's name. Every variant must be of a product the store owns, and
 * each row written is the one matched by cycle, variant and store
 * (`_access.ts`, SD-158). This took any variant id and, through the service's
 * upsert on (cycle, variant), moved another store's row onto this exchange and
 * rewrote its price and quantity. Everything is checked before anything is
 * written.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const loaded = await resolveExchangeAccess(req, res, true)
  if (!loaded) return

  const body = parseRouteInput(res, req.body, addExchangeProductsBody)
  if (!body) return

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const { access, exchange } = loaded
  const variantIds = body.products.map((product) => product.variant_id)

  try {
    if (exchange.seller_id !== access.sellerId) {
      return forbidden(res)
    }
    if (!(await storeOwnsVariants(req, access.sellerId, variantIds))) {
      return forbidden(res)
    }
    // The cycle comes from the exchange itself, so a mismatched path id can
    // never decide where a row lands.
    const cycleId = exchange.order_cycle_id
    if (await cycleRowsHeldByOthers(orderCycleService, cycleId, access.sellerId, variantIds)) {
      return res.status(409).json({
        message: "Another store already lists one of these variants in this order cycle",
      })
    }

    const created: unknown[] = []
    for (const product of body.products) {
      created.push(
        await saveOwnCycleProduct(orderCycleService, cycleId, product.variant_id, access.sellerId, {
          exchange_id: exchange.id,
          available_quantity: product.available_quantity,
          override_price: product.override_price,
        })
      )
    }

    res.status(201).json({ products: created })
  } catch (error) {
    routeFailure(log, req, res, "Failed to add products", error)
  }
}
