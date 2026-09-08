import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../modules/order-cycle/service"
import { resolveCycleAccess } from "../../../_access"

type OrderCycleProductRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveOrderCycleProduct"]>
>

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
 * whose deletions change settlement amounts.
 *
 * The product must belong to the cycle named in the path. Without that check a
 * guessed `:id`/`:productId` pair deletes a row out of a stranger's cycle —
 * the defect that was live on `exchanges/:exchangeId/products` until 2026-09-08
 * and on this surface's fees route before it.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, productId } = req.params

  // Participant or coordinator may reach the cycle; who may delete this
  // particular row is decided below, once we know whose product it is.
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  let product: OrderCycleProductRecord
  try {
    product = await orderCycleService.retrieveOrderCycleProduct(productId)
  } catch (_error) {
    res.status(404).json({ message: "Product not found in order cycle" })
    return
  }

  // Belongs-to check. 404 rather than 403 — a caller who cannot see the cycle
  // this row is in should not learn that the id exists.
  if (product.order_cycle_id !== id) {
    res.status(404).json({ message: "Product not found in order cycle" })
    return
  }

  const isOwner = product.seller_id === access.sellerId
  if (!access.isCoordinator && !isOwner) {
    res.status(403).json({ message: "Access denied" })
    return
  }

  // Mirrors the sibling POST: a dispatched or cancelled cycle is closed to
  // product changes in both directions. Removing a product from a cycle whose
  // boxes have already gone out would rewrite what was actually sent.
  if (["dispatched", "cancelled"].includes(access.orderCycle.status)) {
    res.status(400).json({
      message:
        "Cannot remove products from a dispatched or cancelled order cycle",
    })
    return
  }

  try {
    await orderCycleService.deleteOrderCycleProducts(productId)
    res.status(200).json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res
      .status(500)
      .json({ message: "Failed to remove product from order cycle", error: message })
  }
}
