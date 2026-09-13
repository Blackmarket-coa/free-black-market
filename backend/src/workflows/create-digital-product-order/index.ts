import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse
} from "@medusajs/framework/workflows-sdk"
import {
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

const createDigitalProductOrderWorkflow = createWorkflow(
  "create-digital-product-order",
  (input: WorkflowInput) => {
    acquireLockStep({
      key: input.cart_id,
      timeout: 30,
      ttl: 120,
    });
    const { id } = completeCartWorkflow.runAsStep({
      input: {
        id: input.cart_id
      }
    })

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