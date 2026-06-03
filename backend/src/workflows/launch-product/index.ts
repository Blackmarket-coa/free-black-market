import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import {
  createProductsWorkflow,
  createRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"

import attachCoalitionListingStep from "./steps/attach-coalition-listing"
import createCreatorBountyStep from "./steps/create-creator-bounty"
import createCreatorDealStep from "./steps/create-creator-deal"
import emitLaunchEventsStep from "./steps/emit-launch-events"
import { CreatorProgramType } from "../../modules/creator-program/models/creator-program"

export type LaunchProductWorkflowInput = {
  // Stable per-launch id. The trigger route guards re-entry on this id, and
  // each step reuses artifacts already stamped with it.
  launch_id: string
  seller_id: string
  vendor_mxid?: string | null
  // Fully-formed Medusa product input (the route assembles it from the request).
  product: CreateProductWorkflowInputDTO
  cooperative_id?: string | null
  target_creator_seller_id?: string | null
  demand: {
    title: string
    description: string
    category?: string | null
    delivery_region?: string | null
    target_quantity: number
    min_quantity: number
  }
  bounty: {
    objective: string
    amount: number
    currency_code?: string
    milestones?: Array<{
      description: string
      percentage: number
      condition: string
    }>
  }
  program: {
    title: string
    slug: string
    program_type: CreatorProgramType
    commission_percent?: number | null
    commission_flat_cents?: number | null
    description?: string | null
  }
}

/**
 * The growth-loop spine. A single Launch materializes:
 *  - Producer:  a Medusa product (draft) linked to the seller
 *  - Coalition: a cooperative_listing surfacing the product (when attached)
 *  - Demand:    a demand-post (coalition "need") + creator marketing bounty
 *  - Creator:   a marketing program + (when pre-matched) an approved deal +
 *               default affiliate link
 *  - Bridge:    launch.created / bounty.opened Blackout webhooks
 *
 * The Sale -> Reward tail is already wired (creator-attribution ->
 * collective-hawala -> creator.payout.completed).
 */
const launchProductWorkflow = createWorkflow(
  "launch-product",
  (input: LaunchProductWorkflowInput) => {
    const products = createProductsWorkflow.runAsStep({
      input: { products: [input.product] },
    })

    const productId = transform({ products }, (d) => d.products[0].id)

    createRemoteLinkStep(
      transform({ products, input }, (d) => [
        {
          [SELLER_MODULE]: { seller_id: d.input.seller_id },
          [Modules.PRODUCT]: { product_id: d.products[0].id },
        },
      ])
    )

    const coalition = attachCoalitionListingStep(
      transform({ input, productId }, (d) => ({
        cooperative_id: d.input.cooperative_id ?? "",
        product_id: d.productId,
        name: d.input.product.title,
        launch_id: d.input.launch_id,
      }))
    )

    const bounty = createCreatorBountyStep(
      transform({ input, productId }, (d) => ({
        launch_id: d.input.launch_id,
        cooperative_id: d.input.cooperative_id ?? null,
        product_id: d.productId,
        seller_id: d.input.seller_id,
        title: d.input.demand.title,
        description: d.input.demand.description,
        category: d.input.demand.category ?? null,
        delivery_region: d.input.demand.delivery_region ?? null,
        target_quantity: d.input.demand.target_quantity,
        min_quantity: d.input.demand.min_quantity,
        bounty: d.input.bounty,
      }))
    )

    const deal = createCreatorDealStep(
      transform({ input, productId }, (d) => ({
        launch_id: d.input.launch_id,
        vendor_id: d.input.seller_id,
        product_id: d.productId,
        target_creator_seller_id: d.input.target_creator_seller_id ?? null,
        program: d.input.program,
      }))
    )

    emitLaunchEventsStep(
      transform(
        { input, productId, coalition, bounty, deal },
        (d) => ({
          launch_id: d.input.launch_id,
          vendor_mxid: d.input.vendor_mxid ?? null,
          product_id: d.productId,
          cooperative_id: d.input.cooperative_id ?? null,
          demand_post_id: d.bounty.demand_post_id,
          bounty_id: d.bounty.bounty_id,
          deal_id: d.deal.deal_id,
          affiliate_short_code: d.deal.affiliate_short_code,
          objective: d.input.bounty.objective,
          amount: d.input.bounty.amount,
          currency_code: d.input.bounty.currency_code ?? "USD",
        })
      )
    )

    return new WorkflowResponse(
      transform(
        { input, productId, coalition, bounty, deal },
        (d) => ({
          launch_id: d.input.launch_id,
          product_id: d.productId,
          cooperative_listing_id: d.coalition.cooperative_listing_id,
          demand_post_id: d.bounty.demand_post_id,
          bounty_id: d.bounty.bounty_id,
          program_id: d.deal.program_id,
          deal_id: d.deal.deal_id,
          affiliate_link_id: d.deal.affiliate_link_id,
          affiliate_short_code: d.deal.affiliate_short_code,
          invited_creator_seller_id: d.deal.invited_creator_seller_id,
        })
      )
    )
  }
)

export default launchProductWorkflow
