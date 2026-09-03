import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { ORDER_DISPUTE_MODULE } from "../../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../../modules/order-dispute/service"
import { DisputeStateError } from "../../../../../modules/order-dispute/service"
import {
  DisputeReason,
  sellerShareCents,
  sellersOnOrder,
} from "../../../../../modules/order-dispute/resolution"

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
  items?: {
    total?: number | string | null
    product?: { seller_id?: string | null } | null
  }[]
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
      "items.total",
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

  // A dispute is against ONE vendor. On a multi-vendor order the buyer says
  // which, because taking the first seller found — as this route originally
  // did — names the wrong vendor half the time and, with the live-dispute
  // index scoped per seller, would also consume the buyer's one open slot
  // against a vendor they never meant to accuse.
  const lines = (order.items ?? []).map((i) => ({
    seller_id: i.product?.seller_id ?? null,
    total: i.total ?? 0,
  }))
  const sellers = sellersOnOrder(lines)

  if (!sellers.length) {
    return res
      .status(409)
      .json({ message: "This order has no vendor to dispute against." })
  }

  const requestedSeller =
    typeof body.seller_id === "string" ? body.seller_id.trim() : ""

  let sellerId: string
  if (requestedSeller) {
    if (!sellers.includes(requestedSeller)) {
      // 404-shaped rather than 403: naming a seller not on this order should
      // not confirm whether that seller exists.
      return res
        .status(404)
        .json({ message: "That vendor has no items on this order." })
    }
    sellerId = requestedSeller
  } else if (sellers.length === 1) {
    sellerId = sellers[0]
  } else {
    return res.status(400).json({
      message:
        "This order has items from more than one vendor — name the one you are disputing.",
      sellers,
    })
  }

  // The ceiling is THIS vendor's goods, not the order total. Clamping to the
  // order total would let a claim against one vendor be worth up to another
  // vendor's shipment.
  const claimCeiling = sellerShareCents(lines, sellerId)
  if (claimCeiling <= 0) {
    return res.status(409).json({
      message: "That vendor's items on this order have no value to dispute.",
    })
  }

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  try {
    const dispute = await service.open({
      orderId: order.id,
      sellerId,
      customerId,
      orderPlacedAt: order.created_at,
      orderTotalCents: claimCeiling,
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
