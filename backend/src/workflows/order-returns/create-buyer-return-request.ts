import type { OrderWorkflow } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createAndCompleteReturnOrderWorkflow,
  createRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"

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
 * Callers prove the order is the buyer's and the shipping option is the
 * order seller's before running this; the workflow trusts its input.
 */
export type CreateBuyerReturnRequestInput = {
  order_id: string
  seller_id: string
  customer_id: string
  return_shipping_option_id: string
  note?: string | null
  items: { id: string; quantity: number; reason_id?: string | null }[]
}

export const CREATE_BUYER_RETURN_REQUEST_WORKFLOW_ID = "create-buyer-return-request"

export const createBuyerReturnRequestWorkflow = createWorkflow(
  CREATE_BUYER_RETURN_REQUEST_WORKFLOW_ID,
  (input: CreateBuyerReturnRequestInput) => {
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
        note: input.note || undefined,
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

    return new WorkflowResponse(created)
  }
)
