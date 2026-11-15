import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderWorkflowId } from "@medusajs/medusa/core-flows"
import { createLogger } from "../../shared/logger"
import {
  findOrdersSharingPayment,
  SHARED_PAYMENT_CANCEL_REFUSED,
  sharedPaymentCancelMessage,
  type SharedPaymentCollection,
} from "../../lib/shared-payment-cancel"

const log = createLogger("api/middlewares/shared-payment-order-cancel")

/**
 * The id `refundCapturedPaymentsWorkflow` registers under: the refund half of
 * Medusa's cancel, which refunds captured-minus-refunded on every payment of
 * the order's collections. Medusa registers it globally (cancel-order.js
 * loads it), so the workflow runner below can start it by this id, but
 * core-flows exports neither the workflow nor its id constant from its index
 * and its package `exports` block a deep import. So the string is written
 * here, and `__tests__/shared-payment-order-cancel.unit.spec.ts` pins it to
 * Medusa's registry: registered, and the refund step inside `cancel-order`.
 */
export const REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID = "refund-captured-payments-workflow"

/**
 * Workflows that, given `input.order_id`, refund or void every payment on the
 * order's payment collections, and what the refusal calls that.
 */
export const ORDER_COLLECTION_REFUND_WORKFLOWS: ReadonlyMap<string, "cancel" | "refund"> = new Map([
  [cancelOrderWorkflowId, "cancel"],
  [REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID, "refund"],
])

function refuse(
  res: MedusaResponse,
  orderId: string,
  shared: SharedPaymentCollection[],
  action: "cancel" | "refund",
  via: string
): void {
  log.warn(`[order-cancel] refused ${via} for ${orderId}: its payment collection is shared`, {
    order_id: orderId,
    shared_payment_collections: shared,
  })
  res.status(409).json({
    type: "not_allowed",
    code: SHARED_PAYMENT_CANCEL_REFUSED,
    message: sharedPaymentCancelMessage(orderId, shared, action),
    order_id: orderId,
    shared_payment_collections: shared,
  })
}

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

  refuse(res, orderId, shared, "cancel", "admin cancel")
}

type WorkflowRunBody = { input?: unknown } | null | undefined

/**
 * The order the run names, read from both bodies the route could act on: the
 * parsed body, and `validatedBody` if Medusa's validator for this route has
 * already run (the route reads `validatedBody.input`). Null when either names
 * no order, or not as one non-empty string.
 */
function orderIdsNamed(req: MedusaRequest): string[] | null {
  const bodies: WorkflowRunBody[] = [req.body as WorkflowRunBody]
  if (req.validatedBody !== undefined) bodies.push(req.validatedBody as WorkflowRunBody)
  const ids = new Set<string>()
  for (const body of bodies) {
    const input = body && typeof body === "object" ? body.input : undefined
    const orderId = input && typeof input === "object" ? (input as { order_id?: unknown }).order_id : undefined
    if (typeof orderId !== "string" || orderId.length === 0) return null
    ids.add(orderId)
  }
  return [...ids]
}

/**
 * `POST /admin/workflows-executions/:workflow_id/run` (SD-36 (8)): Medusa's
 * generic workflow runner starts any registered workflow by id with whatever
 * `input` it is sent (@medusajs/medusa 2.14.2,
 * api/admin/workflows-executions/[workflow_id]/run/route.js), so
 * `cancel-order`, or its refund half on its own, can be run on one seller's
 * order without going through the admin cancel route above. Seen on a real
 * database with Medusa's own read crash patched out locally: either run on
 * the $40 order of a $40 + $30 Mercur cart refunded all $70, then answered
 * 500 with both orders still open.
 *
 * The same refusal, for those two workflows only; every other workflow id
 * passes. Fails closed: a run of either that does not name exactly one order
 * as a string is refused with 400 before anything is read or run. Runs after
 * Medusa's admin authentication, like the route above.
 */
export async function refuseSharedPaymentWorkflowRun(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const workflowId = String(req.params?.workflow_id ?? "")
  const action = ORDER_COLLECTION_REFUND_WORKFLOWS.get(workflowId)
  if (!action) return next()

  const orderIds = orderIdsNamed(req)
  if (!orderIds || orderIds.length !== 1) {
    res.status(400).json({
      type: "invalid_data",
      message:
        `Workflow ${workflowId} refunds or voids the payment collections of the order in input.order_id; ` +
        `input.order_id must name exactly one order, as a string.`,
    })
    return
  }

  const [orderId] = orderIds
  const shared = await findOrdersSharingPayment(req.scope, orderId)
  if (shared.length === 0) return next()

  refuse(res, orderId, shared, action, `workflow run ${workflowId}`)
}
