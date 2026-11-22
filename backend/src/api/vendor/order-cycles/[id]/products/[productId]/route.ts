import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { forbidden } from "../../../../../../shared/community-read-access"
import { createLogger } from "../../../../../../shared/logger"
import { parseRouteInput, recordId, routeFailure } from "../../../../../../shared/route-input"
import { storeKeysOf } from "../../../../../../shared/store-keys"
import { resolveCycleAccess } from "../../../_access"

const log = createLogger("api/vendor/order-cycles/[id]/products/[productId]")

const productPath = z.object({ id: recordId, productId: recordId })

type OrderCycleProductRow = { id: string; order_cycle_id: string; seller_id: string }

/**
 * DELETE /vendor/order-cycles/:id/products/:productId
 *
 * The route the vendor panel has been calling since the order-cycle screens
 * shipped. `useRemoveOrderCycleProduct` fetches exactly this path, and it did
 * not exist: there was no `DELETE` handler anywhere under `order-cycles`, so
 * the "remove product" button 404'd and reported "Failed to remove product"
 * (`docs/CDFI_COOP_ROADMAP.md` §3.7, one of the two dead buttons).
 *
 * Authorization is the coordinator OR the product's own seller — the rule
 * `resolveExchangeAccess` already uses for an exchange. A participant adds
 * their own products through the sibling `POST`, which stamps `seller_id` from
 * the caller, so they must be able to take them back out; and a coordinator
 * runs the cycle. It is deliberately NOT coordinator-only like the fees route,
 * whose deletions change settlement amounts. Removal is the one power over
 * another store's row the coordinator has: the sibling POST writes only the
 * caller's own rows, the coordinator's included (SD-158, `_access.ts`).
 *
 * The product must belong to the cycle named in the path. Without that check a
 * guessed `:id`/`:productId` pair deletes a row out of a stranger's cycle —
 * the defect that was live on `exchanges/:exchangeId/products` until 2026-09-08
 * and on this surface's fees route before it. A row that is missing, in
 * another cycle, or another store's (for a participant) gets the same
 * `forbidden()`, so the status says nothing about which row ids exist.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const path = parseRouteInput(res, req.params, productPath)
  if (!path) return
  const { id, productId } = path

  // Participant or coordinator may reach the cycle; who may delete this
  // particular row is decided below, once we know whose product it is.
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  try {
    const [product] = (await orderCycleService.listOrderCycleProducts(
      { id: productId },
      { take: 1 }
    )) as OrderCycleProductRow[]

    // The caller's own row: held under its store's id or one of its members'.
    const isOwner = product ? (await storeKeysOf(req.scope, access.sellerId)).includes(product.seller_id) : false
    if (!product || product.order_cycle_id !== id || (!access.isCoordinator && !isOwner)) {
      return forbidden(res)
    }

    // Mirrors the sibling POST: a dispatched or cancelled cycle is closed to
    // product changes in both directions. Removing a product from a cycle whose
    // boxes have already gone out would rewrite what was actually sent.
    if (["dispatched", "cancelled"].includes(access.orderCycle.status)) {
      return res.status(400).json({
        message:
          "Cannot remove products from a dispatched or cancelled order cycle",
      })
    }

    await orderCycleService.deleteOrderCycleProducts(product.id)
    res.status(200).json({ success: true })
  } catch (error) {
    routeFailure(log, req, res, "Failed to remove product from order cycle", error)
  }
}
