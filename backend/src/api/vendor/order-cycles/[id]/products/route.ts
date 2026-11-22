import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { forbidden } from "../../../../../shared/community-read-access"
import { createLogger } from "../../../../../shared/logger"
import { parseRouteInput, routeFailure } from "../../../../../shared/route-input"
import { storeKeysOf } from "../../../../../shared/store-keys"
import { getSellerId } from "../../../quests/_helpers"
import {
  addCycleProductBody,
  cycleRowsHeldByOthers,
  resolveCycleAccess,
  saveOwnCycleProduct,
  storeOwnsVariants,
} from "../../_access"

const log = createLogger("api/vendor/order-cycles/[id]/products")

/**
 * Vendor API Routes for Order Cycle Products
 *
 * GET /vendor/order-cycles/:id/products - List products in cycle
 * POST /vendor/order-cycles/:id/products - Add product to cycle
 */

// GET /vendor/order-cycles/:id/products
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const sellerId = await getSellerId(req)
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
      // Non-coordinators only see their own products: held under the store's
      // id or one of its members' ids (written before SD-145).
      filters.seller_id = await storeKeysOf(req.scope, sellerId)
    }

    const products = await orderCycleService.listOrderCycleProducts(filters, {
      order: { display_order: "ASC" },
    })

    res.json({ products })
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
  }
}

/**
 * POST /vendor/order-cycles/:id/products — list one of the store's variants in
 * the cycle, or change the store's own row for it.
 *
 * The coordinator or an active participant reaches the cycle; the variant must
 * be of a product the caller's store owns, and the row written is the one
 * matched by cycle, variant and store (`_access.ts`, SD-158). This took any
 * variant id and updated the cycle's row for it whoever owned it, so a
 * participant repriced, emptied and hid the coordinator's listing. A variant
 * that is another store's, or missing, is `forbidden()` with nothing written;
 * the store's variant already listed here by another store is 409.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const body = parseRouteInput(res, req.body, addCycleProductBody)
  if (!body) return

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  // Check cycle is editable (not dispatched or cancelled)
  if (["dispatched", "cancelled"].includes(access.orderCycle.status)) {
    return res.status(400).json({
      message: "Cannot add products to a dispatched or cancelled order cycle",
    })
  }

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    if (!(await storeOwnsVariants(req, access.sellerId, [body.variant_id]))) {
      return forbidden(res)
    }
    const keys = await storeKeysOf(req.scope, access.sellerId)
    const conflict = { message: "Another store already lists this variant in this order cycle" }
    if (await cycleRowsHeldByOthers(orderCycleService, id, keys, [body.variant_id])) {
      return res.status(409).json(conflict)
    }

    const saved = await saveOwnCycleProduct(orderCycleService, id, body.variant_id, keys, {
      available_quantity: body.available_quantity,
      override_price: body.override_price,
      is_visible: body.is_visible ?? true,
      display_order: body.display_order ?? 0,
    })
    if ("conflict" in saved) {
      return res.status(409).json(conflict)
    }

    res.status(201).json({ product: saved.product })
  } catch (error) {
    // Never the error's own text: on a database without SD-63's column every
    // write failed here with the SQL error in a 400.
    routeFailure(log, req, res, "Failed to add product to order cycle", error)
  }
}
