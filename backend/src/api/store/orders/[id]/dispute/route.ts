import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { ORDER_DISPUTE_MODULE } from "../../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../../modules/order-dispute/service"
import { DisputeReason } from "../../../../../modules/order-dispute/resolution"
import {
  isIntakeFailure,
  loadOwnOrderForDispute,
  openDisputeForOrder,
} from "../../../../../shared/order-dispute-intake"

const log = createLogger("api/store/orders/[id]/dispute")

const getCustomerId = (req: MedusaRequest) => {
  const auth = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  return auth?.actor_type === "customer" ? auth.actor_id : undefined
}

/** GET /store/orders/:id/dispute — every dispute on this order, any vendor. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const order = await loadOwnOrderForDispute(req.scope, {
    orderId: id,
    customerId,
  })
  if (isIntakeFailure(order)) return res.status(order.status).json(order.body)

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const disputes = await service.listOrderDisputes({ order_id: order.id })

  return res.json({ disputes })
}

/**
 * POST /store/orders/:id/dispute — raise a dispute.
 *
 * The dispute-native intake. `POST /store/order-claims` is the same intake in
 * the storefront's older claim vocabulary; both go through
 * `shared/order-dispute-intake.ts`, so the rules — prove the order is yours,
 * name the vendor on a multi-vendor order, cap the claim at that vendor's
 * goods, refuse a duplicate — are written once.
 *
 * Records the claim and puts it in the admin queue. It moves no money: most
 * orders settle through Stripe rather than escrow, so the refund (or the
 * escrow transition, where an escrow exists) follows the admin's decision
 * through the modules that own those things.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as Record<string, unknown>
  const description =
    typeof body.description === "string" ? body.description.trim() : ""
  if (!description) {
    return res
      .status(400)
      .json({ message: "Tell us what went wrong — a description is required." })
  }

  const rawReason =
    typeof body.reason === "string" ? body.reason.trim().toLowerCase() : ""
  const reason = Object.values(DisputeReason).includes(rawReason as DisputeReason)
    ? (rawReason as DisputeReason)
    : DisputeReason.OTHER

  try {
    const result = await openDisputeForOrder(req.scope, {
      customerId,
      orderId: id,
      sellerId: typeof body.seller_id === "string" ? body.seller_id : null,
      reason,
      description,
      claimCents:
        typeof body.claim_amount === "number" ? body.claim_amount : null,
      metadata: { intake_source: "store/orders/[id]/dispute" },
    })

    if (!result.ok) return res.status(result.status).json(result.body)
    return res.status(201).json({ dispute: result.dispute })
  } catch (err) {
    log.error("[POST /store/orders/:id/dispute] failed", err)
    return res.status(500).json({ message: "Failed to raise dispute" })
  }
}
