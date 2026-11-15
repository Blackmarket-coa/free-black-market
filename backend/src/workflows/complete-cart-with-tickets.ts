import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  capturePaymentWorkflow,
  completeCartWorkflow,
  createRemoteLinkStep,
  acquireLockStep,
  releaseLockStep,
  useQueryGraphStep
} from "@medusajs/medusa/core-flows"
import { createTicketPurchasesStep, CreateTicketPurchasesStepInput } from "./steps/create-ticket-purchases"
import { TICKET_BOOKING_MODULE } from "../modules/ticket-booking"
import { Modules } from "@medusajs/framework/utils"
import ticketPurchaseOrderLink from "../links/ticket-purchase-order"
import { validateTicketOrderStep, ValidateTicketOrderStepInput } from "./steps/validate-ticket-order"
import { requireCompletedCartOrderStep } from "./steps/require-completed-cart-order"
import { requireSeatedTicketCartStep } from "./steps/require-seated-ticket-cart"
import {
  linkTicketOrderSellerStep,
  resolveTicketSellerStep,
  ticketCheckoutModeStep,
  ticketCompletedCartOrderStep,
  ticketOrderPaidStep,
  ticketPaymentToCaptureStep,
} from "./subscription/steps/subscription-order-settlement"

/**
 * The refetched order row, narrowed where the query result enters the
 * workflow.
 *
 * `useQueryGraphStep` types its rows as the full generated `Order`, whose
 * `items` alone is `Maybe<OrderLineItem>[]` with every field a
 * `T | WorkflowData<T>` union. Carrying that into `WorkflowResponse` exhausts
 * the compiler's comparison depth (TS2321). The cut is made once, here, for
 * the reason spelled out in `create-digital-product-order`: narrowing at the
 * use site does not work, because the comparison happens when the reference is
 * typed.
 *
 * The index signature is deliberate. `POST /store/carts/:id/complete-tickets`
 * serializes `result.order` straight to the response, and this cast is
 * type-only — the runtime object still carries every field the query asked
 * for, so the wire payload is unchanged. Enumerating the fields here would
 * imply a contract this workflow does not actually narrow.
 */
type CompletedTicketOrderRow = {
  id: string
  [key: string]: unknown
}

export type CompleteCartWithTicketsWorkflowInput = {
  cart_id: string
}

/**
 * SD-48 (i) (`FF_TICKET_ORDER_SETTLEMENT_V1`): a ticket sale reaches its
 * seller and the ledger. The storefront checks out every all-ticket cart here
 * (`placeTicketOrder`), and this workflow completes the cart with Medusa's
 * `completeCartWorkflow`, not Mercur's split, so — like a digital product
 * before SD-48 — the order got no Mercur seller link (the card ledger refuses
 * such an order: the seller was never credited and BMC's 3% never taken) and
 * its FBM Stripe payment, authorized only, was never captured. With the flag
 * on, the digital checkout's settlement runs here through the same shared
 * steps (`subscription/steps/subscription-order-settlement.ts`, as its
 * `*Ticket*` steps):
 *
 *   - every line of the cart must be one seat — a ticket variant, its venue
 *     row, seat number and show date, quantity 1 — or the checkout is refused
 *     (`requireSeatedTicketCartStep`, 400), so the card is taken only for
 *     seats it sells. Before Medusa authorizes the payment session on a first
 *     checkout, and before the capture on a replay;
 *   - after the cart lock is taken and before Medusa authorizes the payment
 *     session, the cart's one seller is resolved, and a cart with none or
 *     several is refused (the store route answers 400), so Medusa records
 *     no payment and nothing is captured. The storefront's Stripe button
 *     confirms the card at Stripe before it calls the route, so the buyer's
 *     hold already exists and is left to lapse, as on Blackout's page (SD-48);
 *   - the seats are validated, as before, then the order is linked to that
 *     seller (refused, and rolled back, if a product moved seller while the
 *     card was authorized);
 *   - the seats are sold — the ticket purchases created and linked to the
 *     order — and only then is the card captured (Medusa's
 *     `capturePaymentWorkflow`, so the order transaction and
 *     `payment.captured` follow). Creating the purchase is the seat's lock:
 *     its unique index (`ticket_purchase (ticket_product_id, venue_row_id,
 *     seat_number, show_date) WHERE deleted_at IS NULL`) refuses a second
 *     sale of the seat, so of two carts that pass the seat check for one seat
 *     at once (SD-48 (b)) the second is refused while its card is only
 *     authorized: `completeCartWorkflow`'s compensation deletes its order and
 *     cancels the authorization, and nothing is captured or refunded. A
 *     capture Stripe refuses fails the checkout the same way, and the
 *     purchases are deleted by their own compensation, which frees the seats.
 *
 * Capturing first, as this checkout did at first, turned that race into a
 * charge: the loser was captured, then refunded by `completeCartWorkflow`'s
 * compensation — best effort, so a refund Stripe refused left the card
 * charged with the order already deleted and no ledger record (SD-48 (b)).
 * The order's refetch, too, comes before the capture, so the capture is the
 * last step that can fail. Only `capturePaymentWorkflow`'s own steps after
 * Stripe's capture (its order read, the order transaction, the event) and the
 * lock's release follow it. A failure there undoes the seats and the seller
 * link and keeps the capture: a first checkout's order is deleted and the
 * capture refunded, best effort; a replay's order stays live, captured with no
 * seat, and nothing refunds (see the capture below).
 *
 * With the flag on, the seat check (`validateTicketOrderStep`) is handed
 * `cancel_order_on_rollback: false`, so its compensation does not run
 * Medusa's `cancelOrderWorkflow`, which refunds captured payments, cancels
 * uncaptured ones and emits `order.canceled`. On a first checkout
 * `completeCartWorkflow`'s compensation already removes the order and voids or
 * refunds its payment; a second undo would cancel the authorization, or
 * refund the capture, a second time and announce the cancellation of an order
 * that is being deleted (read from Medusa 2.14.2's `cancel-order.js`; on
 * this stack it fails at its own first order read, SD-36 (8), so none of that
 * was seen happen, and none of this checkout's behaviour rests on that
 * failure). On a replay there is no completion to undo and the order is left
 * for an operator, as SD-48 leaves one (open items (k), (o)):
 * `cancelOrderWorkflow` would instead refund a replay's capture and cancel its
 * order. It is also handed `seats_only: true`, so a line that is not one seat
 * is refused there too, not passed over. With the flag off the seat check is
 * what it was.
 *
 * A replay — this checkout run again on a cart already completed (a retried
 * POST, a double submit's second run) — never runs `completeCartWorkflow`
 * with the flag on: `ticketCompletedCartOrderStep` finds the cart's order
 * first. On a completed cart `completeCartWorkflow` creates nothing but still
 * registers the compensation that refunds a captured payment, so any later
 * failure would refund a sale whose seats stayed sold (SD-48 (1)). The link and
 * capture steps run on a replay in their replay mode: a finished sale is left
 * as it is, and an order its first completion left unlinked or uncaptured is
 * linked to its products' one seller, its seats sold if they are not, and
 * then captured. An order that owes money and has no payment — what Medusa's
 * workflow engine leaves when it stops the first completion before the card
 * is authorized (SD-53) — is refused before anything but the seat-line check
 * runs (`ticketOrderPaidStep`).
 *
 * Flag off, every new step returns before any read, the capture branch does
 * not run, the lock is the old 2 s wait and 10 s hold, and the checkout does
 * what it did: Medusa's completion, the SD-53 guard, the seat check, the
 * ticket purchases.
 */
export const completeCartWithTicketsWorkflow = createWorkflow(
  "complete-cart-with-tickets",
  (input: CompleteCartWithTicketsWorkflowInput) => {
    // SD-48 (i): whether this checkout settles, read once. The cart lock:
    // flag off, 2 s / 10 s as before; flag on, 30 s / 120 s, since the lock
    // is now held across a Stripe capture.
    const mode = ticketCheckoutModeStep()
    acquireLockStep({
      key: input.cart_id,
      timeout: mode.timeout,
      ttl: mode.ttl,
    })

    // SD-48 (i): the order of a cart already completed (flag off: null, unread).
    const completed = ticketCompletedCartOrderStep({ cart_id: input.cart_id })

    // SD-48 (i) review: refuse a cart holding any line that is not one seat
    // (flag off: unread). Before the replay gate, so a first checkout is
    // refused before Medusa authorizes the card and a replay before anything
    // is linked or captured.
    requireSeatedTicketCartStep({ cart_id: input.cart_id })

    // Only a cart not yet completed is checked for its seller and completed;
    // a replay keeps out of completeCartWorkflow and its refund compensation.
    const completion = when(
      "complete-ticket-cart",
      { completed },
      (data) => !data.completed.order_id
    ).then(() => {
      // SD-48 (i): refuse, before payment, a cart no single seller can be credited with.
      const resolvedSeller = resolveTicketSellerStep({ cart_id: input.cart_id })

      const { id: createdOrderId } = completeCartWorkflow.runAsStep({
        input: {
          id: input.cart_id
        }
      })

      // SD-53: Medusa's workflow engine can leave `completeCartWorkflow`
      // unfinished after the order is written and before the card is
      // authorized, handing back no order id. Refused here, before anything
      // reads by that id (an undefined id filters nothing: the refetch below
      // would answer with some order) or sells a seat for it; a retry gets
      // the unpaid order back and is refused the same way. Unconditional, and
      // shared by every FBM completion (steps/require-completed-cart-order).
      requireCompletedCartOrderStep({ cart_id: input.cart_id, order_id: createdOrderId })

      return transform({ createdOrderId, resolvedSeller }, (data) => ({
        order_id: data.createdOrderId,
        seller_id: data.resolvedSeller.seller_id,
      }))
    })

    // A replay's order is the one already there; otherwise, the one just made.
    const checkout = transform({ completed, completion }, (data) => ({
      order_id: (data.completed.order_id ?? data.completion?.order_id) as string,
      mode: data.completed.order_id ? ("replay" as const) : ("initial" as const),
      expected_seller_id: data.completion?.seller_id ?? null,
    }))
    const orderId = transform({ checkout }, (data) => data.checkout.order_id)

    // SD-48 (i) / SD-53: flag on, an order that owes money and has no payment
    // is refused before anything but the seat-line check runs — a replay
    // skips the guard above, and this keeps the seat check's cart read, the
    // seat check, the seller link and the seats out of it. Flag off it reads
    // nothing: the guard has already run.
    ticketOrderPaidStep(
      transform({ checkout, input }, (data) => ({ cart_id: data.input.cart_id, order_id: data.checkout.order_id }))
    )

    const { data: carts } = useQueryGraphStep({
      entity: "cart",
      fields: [
        "id",
        "items.variant.*",
        "items.variant.options.*",
        "items.variant.options.option.*",
        "items.variant.ticket_product_variant.*",
        "items.variant.ticket_product_variant.ticket_product.*",
        "items.variant.ticket_product_variant.purchases.*",
        "items.metadata",
        "items.quantity"
      ],
      filters: {
        id: input.cart_id
      },
      options: {
        throwIfKeyNotFound: true
      }
    })

    const { data: existingLinks } = useQueryGraphStep({
      entity: ticketPurchaseOrderLink.entryPoint,
      fields: ["ticket_purchase.id"],
      filters: { order_id: orderId },
    }).config({ name: "retrieve-existing-links" })

    // The seats, before any money is taken: a seat sold meanwhile fails the
    // checkout while the card is only authorized, so completeCartWorkflow's
    // compensation cancels the hold instead of refunding a capture. Settling,
    // the step's compensation leaves the order alone, and a line that is not
    // one seat is refused rather than passed over (see above).
    when(
      "validate-ticket-order-condition",
      { existingLinks },
      (data) => data.existingLinks.length === 0
    ).then(() => {
      validateTicketOrderStep({
        items: carts[0].items,
        order_id: orderId,
        cancel_order_on_rollback: transform({ mode }, (data) => !data.mode.settle),
        seats_only: transform({ mode }, (data) => data.mode.settle),
      } as unknown as ValidateTicketOrderStepInput)
    })

    // SD-48 (i): link the order to its seller — just made: the seller checked
    // before payment, or the checkout rolls back; a replay's: left as it is
    // when linked, else linked to its products' one seller, never refused.
    const linked = linkTicketOrderSellerStep(
      transform({ checkout }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        expected_seller_id: data.checkout.expected_seller_id,
      }))
    )

    // Which payment the capture below takes (flag off: none, unread). Read
    // here, before any seat is sold: a refusal (more than one candidate)
    // then leaves the seats alone.
    const toCapture = ticketPaymentToCaptureStep(
      transform({ checkout, linked }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        linked_seller_id: data.linked.seller_id,
      }))
    )

    // The seats are sold. Settling, this is also the seat's lock (the
    // purchase's unique index), taken before any money moves; a failure from
    // here on deletes the purchases through this step's compensation.
    when(
      "create-ticket-purchases-condition",
      { existingLinks },
      (data) => data.existingLinks.length === 0
    ).then(() => {
      const ticketPurchases = createTicketPurchasesStep({
        order_id: orderId,
        cart: carts[0]
      } as unknown as CreateTicketPurchasesStepInput)

      const linkData = transform({
        orderId,
        ticketPurchases
      }, (data) => {
        return data.ticketPurchases.map((purchase) => ({
          [TICKET_BOOKING_MODULE]: {
            ticket_purchase_id: purchase.id
          },
          [Modules.ORDER]: {
            order_id: data.orderId
          }
        }))
      })

      createRemoteLinkStep(linkData)
    })

    // The order the route answers with, read before the capture so that the
    // capture is the checkout's last step that can fail (SD-48 (i) second
    // review). A refetch that failed after the capture undid the seats and
    // the seller link: on a first checkout the capture was then refunded,
    // best effort (SD-48 (b)), and on a replay — which has no
    // completeCartWorkflow compensation — not at all, leaving the buyer
    // charged for a seat given back. Settling, the payload therefore shows the
    // payment collection as it was before the capture; nothing first-party
    // reads more than `order.id` from it (the storefront's
    // `placeTicketOrder`). Flag off nothing is captured, so the payload is
    // what it always was.
    const { data: refetchedOrder } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "currency_code",
        "email",
        "customer.*",
        "billing_address.*",
        "payment_collections.*",
        "items.*",
        "total",
        "subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "created_at",
        "updated_at"
      ],
      filters: {
        id: orderId
      }
    }).config({ name: "refetch-order" }) as unknown as {
      data: CompletedTicketOrderRow[]
    }

    // SD-48 (i): take the money the checkout authorized, once its seats are
    // sold and the order read — on a replay too, when the order's first
    // completion left it uncaptured. A refused capture fails the checkout
    // here: the purchases and the seller link are undone, and on a first
    // checkout completeCartWorkflow's compensation deletes the order and
    // cancels the authorization. What still follows Stripe's capture is
    // capturePaymentWorkflow's own later steps (its read of the order, the
    // order transaction, `payment.captured`) and the lock's release. A
    // failure there undoes the seats and the seller link as well, and the
    // capture stays: on a first checkout completeCartWorkflow's compensation
    // deletes the order and tries a refund (`compensatePaymentIfNeededStep`),
    // best effort only (SD-48 open item (b)); on a replay nothing refunds and
    // the order stays live, captured with no seat (`capturedTicketOrdersWithoutSeat`
    // in integration-tests/http/ticket-order-settlement.spec.ts is the query
    // that finds it). Outside the blocks above because `when` blocks do not
    // nest.
    when("capture-ticket-order-payment", { toCapture }, (data) => !!data.toCapture.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ toCapture }, (data) => ({ payment_id: data.toCapture.payment_id as string })),
      })
    })

    releaseLockStep({
      key: input.cart_id,
    })

    return new WorkflowResponse({
      order: refetchedOrder[0],
    })
  }
)
