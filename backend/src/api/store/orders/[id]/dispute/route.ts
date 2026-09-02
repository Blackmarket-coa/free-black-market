import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { ORDER_DISPUTE_MODULE } from "../../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../../modules/order-dispute/service"
import { DisputeStateError } from "../../../../../modules/order-dispute/service"
import { DisputeReason } from "../../../../../modules/order-dispute/resolution"

const log = createLogger("api/store/orders/[id]/dispute")

const getCustomerId = (req: MedusaRequest) => {
  const auth = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  return auth?.actor_type === "customer" ? auth.actor_id : undefined
}

type OrderShape = {
  id: string
  customer_id: string | null
  created_at: string | Date
  currency_code: string | null
  total: number | string | null
  items?: { product?: { seller_id?: string | null } | null }[]
}

/**
 * Load the order and prove the caller bought it.
 *
 * 404 rather than 403 for someone else's order: confirming an order id exists
 * tells a stranger that it does.
 */
async function loadOwnOrder(
  req: MedusaRequest,
  res: MedusaResponse,
  customerId: string
): Promise<OrderShape | null> {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    res.status(400).json({ message: "Missing id" })
    return null
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "customer_id",
      "created_at",
      "currency_code",
      "total",
      "items.product.seller_id",
    ],
    filters: { id },
  })

  const order = data?.[0] as OrderShape | undefined
  if (!order || order.customer_id !== customerId) {
    res.status(404).json({ message: "Order not found" })
    return null
  }
  return order
}

/** GET /store/orders/:id/dispute — the live dispute on this order, if any. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const order = await loadOwnOrder(req, res, customerId)
  if (!order) return

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const rows = await service.listOrderDisputes({ order_id: order.id })

  return res.json({ disputes: rows })
}

/**
 * POST /store/orders/:id/dispute — raise a dispute.
 *
 * The entry point ordinary orders never had. The escrow state machine has
 * modelled arbitration since it was written, but only service contracts and
 * subcontracts could reach it; a buyer with a bad order had nowhere to go.
 *
 * This records the claim and puts it in the admin queue. It moves no money:
 * most orders settle through Stripe rather than escrow, so the refund (or the
 * escrow transition, where an escrow exists) follows the admin's decision
 * through the modules that own those things.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const order = await loadOwnOrder(req, res, customerId)
  if (!order) return

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

  // A multi-vendor order is disputed against the vendor whose items are in
  // question; v1 takes the first seller on the order and records it, so the
  // queue always names a respondent. A per-line dispute is a later refinement,
  // not a reason to leave the buyer with no route at all.
  const sellerId =
    order.items?.find((i) => i.product?.seller_id)?.product?.seller_id ?? null
  if (!sellerId) {
    return res
      .status(409)
      .json({ message: "This order has no vendor to dispute against." })
  }

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  try {
    const dispute = await service.open({
      orderId: order.id,
      sellerId,
      customerId,
      orderPlacedAt: order.created_at,
      orderTotalCents: Math.floor(Number(order.total) || 0),
      currencyCode: order.currency_code ?? "usd",
      reason,
      description,
      claimCents:
        typeof body.claim_amount === "number" ? body.claim_amount : null,
    })

    return res.status(201).json({ dispute })
  } catch (err) {
    if (err instanceof DisputeStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /store/orders/:id/dispute] failed", err)
    return res.status(500).json({ message: "Failed to raise dispute" })
  }
}
