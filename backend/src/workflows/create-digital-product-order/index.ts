import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import {
  capturePaymentWorkflow,
  completeCartWorkflow,
  useQueryGraphStep,
  createRemoteLinkStep,
  createOrderFulfillmentWorkflow,
  emitEventStep,
  acquireLockStep,
  releaseLockStep
} from "@medusajs/medusa/core-flows"
import {
  Modules
} from "@medusajs/framework/utils"
import createDigitalProductOrderStep, { 
  CreateDigitalProductOrderStepInput
} from "./steps/create-digital-product-order"
import { DIGITAL_PRODUCT_MODULE } from "../../modules/digital-product"
import digitalProductOrderOrderLink from "../../links/digital-product-order";
import {
  digitalProductCompletedCartOrderStep,
  digitalProductOrderPaidStep,
  digitalProductPaymentToCaptureStep,
  linkDigitalProductOrderSellerStep,
  resolveDigitalProductSellerStep,
} from "../subscription/steps/subscription-order-settlement"

/**
 * The order fields this workflow reads, narrowed where the query result enters
 * it.
 *
 * `useQueryGraphStep` types its rows as the full generated `Order` — a hundred
 * and some fields, each one a `T | WorkflowData<T>` union — and every SDK
 * construct that touches them has to compare
 * `(Order | WorkflowData<Order>)[]` against
 * `((Order | WorkflowData<Order>) & Order)[]`. That exhausts the compiler's
 * comparison depth (TS2321). Narrowing at each use site does not work: the
 * comparison happens when the reference is typed, so clearing it at the
 * `transform` simply moved the same error onto the `WorkflowResponse`. The deep
 * type has to be cut where it enters, once.
 *
 * Narrowing here also narrows the `order` this workflow returns, which is fine
 * and was checked rather than assumed: both callers
 * (`api/v1/checkout/sessions/[id]/page` and the Blackout checkout route)
 * already read the result as `{ order?: { id?: string } }` and use nothing
 * else.
 *
 * The error surfaced only once `.medusa/` generated types existed, so neither
 * `medusa build` nor the CI typecheck job ever reported it — that gap is W3-7,
 * and this is one of the two files that had to be fixed before the job could
 * generate types and stay green.
 */
type DigitalProductItem = {
  id: string
  quantity: number
  variant?: { digital_product?: unknown } | null
} | null

type DigitalProductOrderRow = {
  id: string
  items?: DigitalProductItem[]
}

type WorkflowInput = {
  cart_id: string
}

/**
 * SD-48 (`FF_DIGITAL_ORDER_SETTLEMENT_V1`): the sale reaches its seller and
 * the ledger. This workflow completes the cart with Medusa's
 * `completeCartWorkflow`, not Mercur's split, so — like a subscription
 * before F5 — the order got no Mercur seller link (the card ledger refuses
 * such an order, so the seller was never credited and BMC's 3% never taken)
 * and its card payment, authorized only (`capture` is unset on FBM's Stripe
 * provider), was never captured. With the flag on, F5's own step functions
 * (`subscription/steps/subscription-order-settlement.ts`, as its
 * `*DigitalProduct*` steps) resolve the cart's one seller before Medusa
 * authorizes the payment session and refuse a cart with none or several (so
 * nothing is captured; a card the buyer already confirmed at Stripe, as
 * Blackout's page does before it calls complete, keeps that hold until it
 * lapses), link the order to that seller, and capture the card (Medusa's
 * `capturePaymentWorkflow`, so the order transaction and `payment.captured`
 * follow) before the digital product order is created. A refused capture
 * fails the checkout: the authorization is cancelled and the order and its
 * seller link are removed, but Medusa keeps the cancelled payment on the
 * cart's payment collection, so the capture step passes over a cancelled
 * payment whose session is gone and a retry with a new session completes
 * normally (SD-48). Every other uncaptured FBM card payment stays the one to
 * capture, so a payment whose session was replaced mid-checkout is refused
 * at the capture rather than skipped. A failure after the capture deletes the order
 * through `completeCartWorkflow`'s compensation, which then tries to refund
 * the capture (`compensatePaymentIfNeededStep`) — best effort: a refund
 * Stripe refuses is only logged by Medusa, the card stays charged with no
 * order, and the failed run's `payment.captured` event is dropped with it,
 * so the ledger never hears of the charge (SD-48 open item). Flag off, those
 * steps return before any read and the capture branch does not run: the
 * workflow does exactly what it did.
 *
 * The seller is resolved after the cart lock is taken, so the cart checked is
 * the cart completed: the lock is held from the first step to the last, and
 * `completeCartWorkflow`, run as a step here, skips its own. The same lock
 * keeps two checkouts of one cart at once (a double submit) apart: the second
 * waits, then finds the first's order and returns it as a replay (seen on a
 * real database, SD-48). Medusa's locking module here is its in-memory
 * provider (none is configured), so this holds within one server process.
 *
 * A replay — this checkout run again on a cart already completed (a retried
 * store call, a refreshed checkout page, Blackout's "retry finishes the
 * record") — never runs `completeCartWorkflow`: with the flag on,
 * `digitalProductCompletedCartOrderStep` finds the cart's order first. Run on
 * a completed cart, `completeCartWorkflow` creates nothing but still
 * registers a compensation that refunds a captured payment, so any later
 * failure — a seller re-linked since the sale, a transient read error —
 * refunded a sale whose order and delivery stayed (seen on a real database).
 * The link and capture steps still run on a replay, in their replay mode: an
 * order already linked keeps its seller and a captured one is left alone, so
 * a replay of a finished sale changes nothing; an order whose first
 * completion stopped before its link or capture (a restart mid-checkout, or
 * Medusa's Stripe webhook completing the cart) is linked to its products'
 * one seller and captured before the digital product order is created. A
 * refused capture fails the retry before anything is delivered, and nothing
 * on this path refunds anything. An order with no single seller is neither
 * linked nor captured, and is delivered as without the flag (SD-48 open
 * item).
 *
 * Last before delivery, an order that owes money and has no payment is
 * refused (`digitalProductOrderPaidStep`). That is what Medusa's workflow
 * engine leaves when it stops `completeCartWorkflow` after the order and
 * before the card is authorized (SD-53): that first checkout is refused for
 * want of an order id, and its retry, finding the order as a replay, would
 * otherwise deliver it unpaid.
 */
const createDigitalProductOrderWorkflow = createWorkflow(
  "create-digital-product-order",
  (input: WorkflowInput) => {
    acquireLockStep({
      key: input.cart_id,
      timeout: 30,
      ttl: 120,
    });

    // SD-48: the order of a cart already completed (flag off: null, unread).
    const completed = digitalProductCompletedCartOrderStep({ cart_id: input.cart_id })

    // Only a cart not yet completed is checked for its seller and completed;
    // a replay keeps out of completeCartWorkflow and its refund compensation.
    const completion = when(
      "complete-digital-product-cart",
      { completed },
      (data) => !data.completed.order_id
    ).then(() => {
      // SD-48: refuse, before payment, a cart no single seller can be credited with.
      const resolvedSeller = resolveDigitalProductSellerStep({ cart_id: input.cart_id })

      const { id: createdOrderId } = completeCartWorkflow.runAsStep({
        input: {
          id: input.cart_id
        }
      })

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

    // SD-48: link the order to its seller — just made: the seller checked
    // before payment, or the checkout rolls back; a replay's: left as it is
    // when linked, else linked to its products' one seller (its first
    // completion stopped before the link), never refused.
    const linked = linkDigitalProductOrderSellerStep(
      transform({ checkout }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        expected_seller_id: data.checkout.expected_seller_id,
      }))
    )

    const toCapture = digitalProductPaymentToCaptureStep(
      transform({ checkout, linked }, (data) => ({
        order_id: data.checkout.order_id,
        mode: data.checkout.mode,
        linked_seller_id: data.linked.seller_id,
      }))
    )

    // SD-48: take the money the checkout authorized, before the digital
    // product order exists — on a replay too, when the order's first
    // completion left it uncaptured. A refused capture fails the checkout
    // here, before anything is delivered. After a first completion, a later
    // failure leaves completeCartWorkflow's compensation to try a refund
    // (`compensatePaymentIfNeededStep`), best effort only — see above; a
    // replay has no such compensation, so nothing refunds its capture.
    // Outside the block above because `when` blocks do not nest.
    when("capture-digital-product-order-payment", { toCapture }, (data) => !!data.toCapture.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ toCapture }, (data) => ({ payment_id: data.toCapture.payment_id as string })),
      })
    })

    // SD-48: nothing is delivered for an order that owes money and has no
    // payment, which is what a first completion Medusa's workflow engine left
    // unfinished leaves behind for a retry to find (SD-53).
    digitalProductOrderPaidStep(transform({ checkout }, (data) => ({ order_id: data.checkout.order_id })))

    const id = transform({ checkout }, (data) => data.checkout.order_id)

    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "*",
        "items.*",
        "items.variant.*",
        "items.variant.digital_product.*",
        "shipping_address.*",
      ],
      filters: {
        id
      },
      options: {
        throwIfKeyNotFound: true
      }
    }) as unknown as { data: DigitalProductOrderRow[] }

    const { data: existingLinks } = useQueryGraphStep({
      entity: digitalProductOrderOrderLink.entryPoint,
      fields: ["digital_product_order.id"],
      filters: { order_id: id },
    }).config({ name: "retrieve-existing-links" });

    const itemsWithDigitalProducts = transform(
      {
        orders,
      },
      (data) => {
        return data.orders[0].items?.filter(
          (item) => item?.variant?.digital_product !== undefined
        );
      }
    );

    const digital_product_order = when(
      "create-digital-product-order-condition",
      { itemsWithDigitalProducts, existingLinks },
      (data) => {
        return (
          !!data.itemsWithDigitalProducts?.length &&
          data.existingLinks.length === 0
        );
      }
    )
    .then(() => {
      const { 
        digital_product_order,
      } = createDigitalProductOrderStep({
        items: orders[0].items
      } as unknown as CreateDigitalProductOrderStepInput)
  
      createRemoteLinkStep([{
        [DIGITAL_PRODUCT_MODULE]: {
          digital_product_order_id: digital_product_order.id
        },
        [Modules.ORDER]: {
          order_id: id
        }
      }])

      createOrderFulfillmentWorkflow.runAsStep({
        input: {
          order_id: id,
          items: transform({
            itemsWithDigitalProducts
          }, (data) => {
            return data.itemsWithDigitalProducts!.map((item) => ({
              id: item!.id,
              quantity: item!.quantity
            }))
          })
        }
      })
  
      emitEventStep({
        eventName: "digital_product_order.created",
        data: {
          id: digital_product_order.id
        }
      })

      return digital_product_order
    })

    releaseLockStep({
      key: input.cart_id,
    })

    return new WorkflowResponse({
      order: orders[0],
      digital_product_order
    })
  }
)

export default createDigitalProductOrderWorkflow