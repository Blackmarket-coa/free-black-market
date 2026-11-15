import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { completeCartWithTicketsWorkflow } from "../../../../../workflows/complete-cart-with-tickets"

/**
 * The storefront's checkout for every all-ticket cart (`placeTicketOrder`).
 *
 * SD-48 (i): with `FF_TICKET_ORDER_SETTLEMENT_V1` on, the workflow settles the
 * sale like the digital checkout: a cart holding a line that is not one seat
 * (a ticket variant naming its venue row, seat number and show date,
 * quantity 1), or whose tickets do not all belong to one seller, is refused
 * before Medusa authorizes the payment session (400, the error handler's
 * answer to the workflow's NOT_ALLOWED; the storefront's Stripe button has
 * already confirmed the card by then, and that hold is left to lapse); the
 * order is linked to its seller, its seats are sold, and only then is the
 * card captured. Flag off, the route answers as it always did. A completion
 * Medusa's engine left unfinished is refused either way (409
 * `cart_completion_incomplete`, SD-53).
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { result } = await completeCartWithTicketsWorkflow(req.scope).run({
    input: {
      cart_id: req.params.id
    }
  })

  res.json({
    type: "order",
    order: result.order,
  })
}
