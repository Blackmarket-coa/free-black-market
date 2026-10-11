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
 * `completeCartWorkflow`, not Mercur's split, so — like a subscription before
 * F5 — the order got no Mercur seller link (the card ledger refuses such an
 * order, so the seller was never credited and BMC's 3% never taken) and its
 * card payment, authorized only (`capture` is unset on FBM's Stripe provider),
 * was never captured. With the flag on, F5's own step functions
 * (`subscription/steps/subscription-order-settlement.ts`, as its
 * `*DigitalProduct*` steps) resolve the cart's one seller before any payment is
 * authorized and refuse a cart with none or several, link the order to that
 * seller, and capture the card (Medusa's `capturePaymentWorkflow`, so the
 * order transaction and `payment.captured` follow) before the digital product
 * order is created. A refused capture fails the checkout with nothing left
 * behind; a failure after it is refunded by `completeCartWorkflow`'s own
 * compensation. Flag off, those steps return before any read and the capture
 * branch does not run: the workflow does exactly what it did.
 *
 * The seller is resolved after the cart lock is taken, so the cart checked is
 * the cart completed (`completeCartWorkflow` skips its own lock when it runs
 * as a step here).
 *
 * A replay — this checkout run again on a cart already completed (a retried
 * store call, a refreshed checkout page, Blackout's "retry finishes the
 * record") — runs none of that, nor `completeCartWorkflow` itself: with the
 * flag on, `digitalProductCompletedCartOrderStep` finds the cart's order
 * first and the order is returned as its first completion left it. Run on a
 * completed cart, `completeCartWorkflow` creates nothing but still registers
 * a compensation that refunds a captured payment, so any later failure — a
 * seller re-linked since the sale, a transient read error — refunded a sale
 * whose order and delivery stayed (seen on a real database).
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

    // Only a cart not yet completed is completed, linked and charged; a
    // replay keeps out of completeCartWorkflow and its refund compensation.
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

      linkDigitalProductOrderSellerStep({
        order_id: createdOrderId,
        mode: "initial",
        expected_seller_id: resolvedSeller.seller_id,
      })

      const toCapture = digitalProductPaymentToCaptureStep({
        order_id: createdOrderId,
        mode: "initial",
      })

      return transform({ createdOrderId, toCapture }, (data) => ({
        order_id: data.createdOrderId,
        payment_id: data.toCapture.payment_id,
      }))
    })

    // A replay's order is the one already there; otherwise, the one just made.
    const checkout = transform({ completed, completion }, (data) => ({
      order_id: (data.completed.order_id ?? data.completion?.order_id) as string,
      payment_id: data.completion?.payment_id ?? null,
    }))

    // SD-48: take the money the checkout authorized, before the digital
    // product order exists. A refused capture fails the checkout here; a
    // failure after it is refunded by completeCartWorkflow's own compensation
    // (`compensatePaymentIfNeededStep` refunds a captured payment). Outside the
    // block above because `when` blocks do not nest.
    when("capture-digital-product-order-payment", { checkout }, (data) => !!data.checkout.payment_id).then(() => {
      capturePaymentWorkflow.runAsStep({
        input: transform({ checkout }, (data) => ({ payment_id: data.checkout.payment_id as string })),
      })
    })

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