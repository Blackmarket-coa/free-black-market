import type { OrderWorkflow } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  createAndCompleteReturnOrderWorkflow,
  createRemoteLinkStep,
  releaseLockStep,
} from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { assertReturnableQuantities, type ReturnableItem } from "./returnable-quantity"

/**
 * A buyer's return request, as a Medusa return the seller can see.
 *
 * Two things have to happen for a request to reach anyone:
 *
 * 1. Medusa's own `createAndCompleteReturnOrderWorkflow` — the workflow core's
 *    `POST /store/returns` runs — creates the return on the order (status
 *    `requested`) with its return fulfillment at the seller's location.
 * 2. Mercur's seller–return link is written. `/vendor/returns` and every
 *    `/vendor/returns/:id/*` action read and authorize through that link and
 *    nothing else, and no installed code writes it: `@mercurjs/requests`,
 *    which did (on vendor acceptance), is no longer loaded. A return without
 *    the link exists in the database and is invisible to the seller.
 *
 * Both run in one workflow so the link step's failure compensates the return
 * rather than leaving one the seller can never see.
 *
 * Core's workflow takes no lock and checks quantities as `fulfilled -
 * return_requested`. Two guards close what that leaves open (both seen on a
 * real database before they were added):
 *
 * - The whole run holds a lock on the order id, the key core's own order
 *   workflows lock on (order edits, marking a fulfillment delivered). Without
 *   it two simultaneous requests for the same units both passed core's check
 *   and both created a return, while the item's `return_requested_quantity`
 *   kept only one of the two writes.
 * - Inside the lock, `validateBuyerReturnableQuantitiesStep` also subtracts
 *   what was already received, dismissed or written off, so units the seller
 *   has taken back cannot be asked for again.
 *
 * The lock is the Locking Module's default provider. With no provider
 * configured (as in `medusa-config.ts` today) that is in-memory, so it
 * serialises requests within one server process, as it does for core's own
 * order and cart locks.
 *
 * Callers prove the order is the buyer's and the shipping option is the
 * order seller's before running this; the workflow trusts its input.
 */
export type CreateBuyerReturnRequestInput = {
  order_id: string
  seller_id: string
  customer_id: string
  return_shipping_option_id: string
  items: { id: string; quantity: number; reason_id?: string | null }[]
}

export const CREATE_BUYER_RETURN_REQUEST_WORKFLOW_ID = "create-buyer-return-request"

/**
 * Seconds a request waits for another request on the same order to finish,
 * and seconds the lock lives if its holder dies without releasing it. Core's
 * return workflow takes a second or two; the wait covers a queue of a few.
 */
export const BUYER_RETURN_LOCK_TIMEOUT_S = 15
export const BUYER_RETURN_LOCK_TTL_S = 30

/**
 * Reads the order's items fresh (inside the lock) and refuses quantities
 * beyond what is still returnable. See `returnable-quantity.ts`.
 */
export const validateBuyerReturnableQuantitiesStep = createStep(
  "validate-buyer-returnable-quantities",
  async (
    input: { order_id: string; items: { id: string; quantity: number }[] },
    { container }
  ) => {
    const orderModule = container.resolve(Modules.ORDER)
    const [order] = await orderModule.listOrders(
      { id: input.order_id },
      { relations: ["items"] }
    )
    assertReturnableQuantities(
      (order?.items ?? []) as unknown as ReturnableItem[],
      input.items
    )
    return new StepResponse(undefined)
  }
)

export const createBuyerReturnRequestWorkflow = createWorkflow(
  CREATE_BUYER_RETURN_REQUEST_WORKFLOW_ID,
  (input: CreateBuyerReturnRequestInput) => {
    acquireLockStep({
      key: input.order_id,
      timeout: BUYER_RETURN_LOCK_TIMEOUT_S,
      ttl: BUYER_RETURN_LOCK_TTL_S,
    })

    validateBuyerReturnableQuantitiesStep({
      order_id: input.order_id,
      items: input.items,
    })

    const returnInput = transform(
      { input },
      ({ input }): OrderWorkflow.CreateOrderReturnWorkflowInput => ({
        order_id: input.order_id,
        created_by: input.customer_id,
        items: input.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          reason_id: item.reason_id ?? undefined,
        })),
        // No `price`: the option's own calculated price applies. Core's store
        // route lets the caller name a price; a buyer has no business setting
        // what their return shipping costs.
        return_shipping: { option_id: input.return_shipping_option_id },
        // No `note`: core's workflow does not forward one to the return.
      })
    )

    const created = createAndCompleteReturnOrderWorkflow.runAsStep({
      input: returnInput,
    })

    const sellerLink = transform({ input, created }, ({ input, created }) => [
      {
        [SELLER_MODULE]: { seller_id: input.seller_id },
        [Modules.ORDER]: { return_id: created.id },
      },
    ])
    createRemoteLinkStep(sellerLink)

    releaseLockStep({ key: input.order_id })

    return new WorkflowResponse(created)
  }
)
