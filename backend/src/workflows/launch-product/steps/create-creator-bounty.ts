import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import DemandPoolModuleService from "../../../modules/demand-pool/service"
import { DEMAND_POOL_MODULE } from "../../../modules/demand-pool"
import { DemandPostStatus } from "../../../modules/demand-pool/models/demand-post"
import { getCollectiveHawalaService } from "../../../services/collective-hawala"

export type CreateCreatorBountyInput = {
  launch_id: string
  cooperative_id?: string | null
  product_id: string
  // The vendor/seller launching (becomes the demand-post creator + bounty contributor).
  seller_id: string
  title: string
  description: string
  category?: string | null
  delivery_region?: string | null
  target_quantity: number
  min_quantity: number
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
}

/**
 * Creates the producer's demand-post (a coalition "need" when a cooperative is
 * attached) and a creator marketing bounty against it, then publishes the post
 * to OPEN so creators can discover and claim it. Idempotent per `launch_id`.
 */
const createCreatorBountyStep = createStep(
  "create-creator-bounty-step",
  async (data: CreateCreatorBountyInput, { container }) => {
    const service = container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

    // Idempotency: reuse the demand-post already created for this launch.
    const existingPosts = await service.listDemandPosts({
      launch_id: data.launch_id,
    })
    if (existingPosts.length > 0) {
      const post = existingPosts[0]
      const bounties = await service.listDemandBounties({
        demand_post_id: post.id,
      })
      return new StepResponse(
        {
          demand_post_id: post.id as string,
          bounty_id: (bounties[0]?.id ?? null) as string | null,
        },
        { created: false, demand_post_id: post.id as string }
      )
    }

    const post = await service.createDemandPost({
      creator_id: data.seller_id,
      creator_type: "SELLER",
      title: data.title,
      description: data.description,
      category: data.category ?? undefined,
      target_quantity: data.target_quantity,
      min_quantity: data.min_quantity,
      delivery_region: data.delivery_region ?? undefined,
      cooperative_id: data.cooperative_id ?? undefined,
      launch_id: data.launch_id,
      product_id: data.product_id,
    })

    // Publish DRAFT -> OPEN so the bounty is discoverable.
    await service.publishDemandPost(post.id)

    const bounty = await service.addBounty({
      demand_post_id: post.id,
      contributor_id: data.seller_id,
      contributor_type: "SELLER",
      objective: data.bounty.objective,
      amount: data.bounty.amount,
      currency_code: data.bounty.currency_code ?? "USD",
      milestones: data.bounty.milestones,
    })

    // A funded bounty must be backed by escrow so the displayed reward is real.
    // Locks the amount from the seller's wallet into the demand-pool escrow; if
    // the wallet can't cover it the step throws and the post is rolled back.
    if (Number(data.bounty.amount) > 0) {
      const hawala = getCollectiveHawalaService(container)
      await hawala.escrowBountyFunds({
        demand_post_id: post.id,
        bounty_id: bounty.id,
        contributor_id: data.seller_id,
        amount: Number(data.bounty.amount),
      })
    }

    return new StepResponse(
      {
        demand_post_id: post.id as string,
        bounty_id: bounty.id as string,
      },
      { created: true, demand_post_id: post.id as string }
    )
  },
  async (comp, { container }) => {
    if (!comp || !comp.created || !comp.demand_post_id) {
      return
    }
    const service = container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
    // Soft-cancel rather than hard-delete, matching the lifecycle enums.
    try {
      await service.transitionDemandStatus(
        comp.demand_post_id,
        DemandPostStatus.CANCELLED
      )
    } catch {
      // best-effort compensation
    }
  }
)

export default createCreatorBountyStep
