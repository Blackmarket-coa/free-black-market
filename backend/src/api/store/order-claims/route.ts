import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REQUEST_MODULE } from "../../../modules/request"
import type RequestModuleService from "../../../modules/request/service"
import {
  REQUEST_TYPES,
  orderClaimPayloadSchema,
} from "../../../modules/request/validators"
import { requireCustomerId } from "../../../shared"

/**
 * Buyer claims: "it never arrived", "it isn't what was described".
 *
 * Medusa's returns flow presupposes the item is in the buyer's hands, so the
 * most common complaint — a parcel that never showed up — had no path at all,
 * while `/how-it-works` promised buyers "we'll step in to make it right". This
 * is the mechanism behind that promise.
 *
 * Built on the existing `request` module rather than a new one: it already has
 * a customer-submits / admin-triages lifecycle (PENDING → ACCEPTED/REJECTED),
 * store and admin routes, and an approve/reject surface. A parallel claims
 * module would duplicate all of it.
 */

/**
 * How long after an order a claim can be filed.
 *
 * Long enough to cover slow shipping and a buyer who waited on the seller
 * first, short enough that evidence still exists. Published on
 * `/buyer-protection` — change both together.
 */
export const CLAIM_WINDOW_DAYS = 30

/**
 * GET /store/order-claims
 * The claims this customer has filed, with their current status.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

  const claims = await requestService.listRequests({
    submitter_id: customerId,
    type: REQUEST_TYPES.ORDER_CLAIM,
  })

  res.json({ claims, count: claims.length })
}

/**
 * POST /store/order-claims
 * File a claim against one of your own orders.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const parsed = orderClaimPayloadSchema.safeParse({
    ...(req.body as Record<string, unknown>),
    type: REQUEST_TYPES.ORDER_CLAIM,
  })

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid claim",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Confirm the order is this customer's before recording anything against it.
  // Without this check any authenticated customer could file claims against
  // strangers' orders, which is both a privacy leak (the claim is visible to
  // admins alongside the order) and an abuse vector.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "customer_id", "created_at"],
    filters: { id: parsed.data.order_id },
  })

  const order = orders?.[0]
  if (!order || order.customer_id !== customerId) {
    // Deliberately the same response for "no such order" and "not yours" —
    // distinguishing them would confirm an order id exists.
    return res
      .status(404)
      .json({ message: "Order not found", type: "not_found" })
  }

  const orderAgeMs = Date.now() - new Date(order.created_at).getTime()
  if (orderAgeMs > CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return res.status(422).json({
      message: `Claims can be filed within ${CLAIM_WINDOW_DAYS} days of an order. Your card issuer's dispute window is usually longer — contact them if this order is outside ours.`,
      type: "claim_window_expired",
    })
  }

  const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

  // One open claim per order. A buyer adding detail should not create a second
  // ticket a reviewer has to reconcile against the first.
  const existing = await requestService.listRequests({
    submitter_id: customerId,
    type: REQUEST_TYPES.ORDER_CLAIM,
    status: "pending",
  })

  const duplicate = existing.find(
    (claim) =>
      (claim.data as { order_id?: string } | null)?.order_id ===
      parsed.data.order_id
  )

  if (duplicate) {
    return res.status(409).json({
      message:
        "You already have an open claim on this order. Reply on that claim rather than filing another.",
      type: "duplicate_claim",
      claim_id: duplicate.id,
    })
  }

  const claim = await requestService.createRequest({
    type: REQUEST_TYPES.ORDER_CLAIM,
    submitter_id: customerId,
    data: {
      order_id: parsed.data.order_id,
      reason: parsed.data.reason,
      description: parsed.data.description,
      evidence_urls: parsed.data.evidence_urls,
      contacted_seller: parsed.data.contacted_seller,
    },
  })

  res.status(201).json({ claim })
}
