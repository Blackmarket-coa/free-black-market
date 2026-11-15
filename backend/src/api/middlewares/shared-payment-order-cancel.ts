import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../shared/logger"
import {
  findOrdersSharingPayment,
  SHARED_PAYMENT_CANCEL_REFUSED,
  sharedPaymentCancelMessage,
} from "../../lib/shared-payment-cancel"

const log = createLogger("api/middlewares/shared-payment-order-cancel")

/**
 * `POST /admin/orders/:id/cancel` (SD-36 (8)): Medusa's own route, kept as
 * it is, runs `cancelOrderWorkflow`, which refunds or voids every payment on
 * the order's payment collections. On a Mercur multi-seller cart that
 * collection is shared by every seller's order, so cancelling one order
 * would refund the whole cart at the provider. Refused here, before the
 * route runs, with 409 and what to do instead (lib/shared-payment-cancel.ts).
 *
 * An order whose collections are its own — every single-seller cart —
 * reaches Medusa's route untouched. Runs after Medusa's admin authentication
 * (the framework binds it on /admin before any route middleware), so an
 * unauthenticated caller learns nothing about the order. A failure to read
 * the order's collections is not swallowed: it reaches the error handler and
 * the cancel does not run.
 */
export async function refuseSharedPaymentOrderCancel(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const orderId = String(req.params?.id ?? "")
  if (!orderId) return next()

  const shared = await findOrdersSharingPayment(req.scope, orderId)
  if (shared.length === 0) return next()

  log.warn(`[order-cancel] refused admin cancel of ${orderId}: its payment collection is shared`, {
    order_id: orderId,
    shared_payment_collections: shared,
  })
  res.status(409).json({
    type: "not_allowed",
    code: SHARED_PAYMENT_CANCEL_REFUSED,
    message: sharedPaymentCancelMessage(orderId, shared),
    order_id: orderId,
    shared_payment_collections: shared,
  })
}
