import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { requireCustomerId } from "../../../shared"
import { forbidden } from "../../../shared/community-read-access"
import { createBuyerReturnRequestWorkflow } from "../../../workflows/order-returns/create-buyer-return-request"
import {
  isSellersReturnOption,
  listCustomerReturnRequests,
  loadOrderForReturn,
  returnRequestBodySchema,
} from "./helpers"

/**
 * Buyer return requests — the storefront's `/user/returns` page and the
 * "Return" action on each order. See `helpers.ts` for why this path exists
 * and what it is built on.
 *
 * Authentication is required by the `/store/return-request` entry in
 * `src/api/middlewares.ts`; the handlers re-check the actor so a missing
 * middleware fails closed.
 */

/**
 * GET /store/return-request
 * The customer's returns, in the `order_return_request` shape.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const requests = await listCustomerReturnRequests(req.scope, customerId)
  res.json({ order_return_requests: requests, count: requests.length })
}

/**
 * POST /store/return-request
 * Ask to return items from one of your own orders.
 *
 * The request becomes a Medusa return on the order, linked to the order's
 * seller so it appears in `/vendor/returns`, where the seller receives or
 * dismisses the items. A refund is not issued here: it follows the seller
 * receiving the goods, as for any Medusa return.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const parsed = returnRequestBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid return request",
      type: "invalid_data",
      errors: parsed.error.issues,
    })
  }
  const body = parsed.data

  // "No such order" and "not yours" are the same 403: a split would tell a
  // stranger which order ids exist.
  const order = await loadOrderForReturn(req.scope, body.order_id)
  if (!order || order.customer_id !== customerId) {
    return forbidden(res)
  }

  if (!order.seller?.id) {
    return res.status(409).json({
      message: "This order has no seller to return it to.",
      type: "no_vendor",
    })
  }

  if (!(await isSellersReturnOption(req.scope, order, body.shipping_option_id))) {
    return res.status(400).json({
      message: "That return method is not offered for this order.",
      type: "invalid_data",
    })
  }

  // Core validates the rest — items on the order, quantities within what was
  // fulfilled and not already returned, reasons that exist — and its
  // MedusaErrors reach the client as 400s through the error handler.
  const { result } = await createBuyerReturnRequestWorkflow(req.scope).run({
    input: {
      order_id: order.id,
      seller_id: order.seller.id,
      customer_id: customerId,
      return_shipping_option_id: body.shipping_option_id,
      note: body.customer_note,
      items: body.line_items.map((item) => ({
        id: item.line_item_id,
        quantity: item.quantity,
        reason_id: item.reason_id,
      })),
    },
  })

  const [request] = await listCustomerReturnRequests(req.scope, customerId, {
    returnId: result.id,
  })

  res.status(201).json({ order_return_request: request })
}
