import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import DemandPoolModuleService from "../../../modules/demand-pool/service"
import { DEMAND_POOL_MODULE } from "../../../modules/demand-pool"
import { BountyStatus } from "../../../modules/demand-pool/models/demand-bounty"
import { DemandPostStatus } from "../../../modules/demand-pool/models/demand-post"
import { getCollectiveHawalaService } from "../../../services/collective-hawala"
import { createLogger } from "../../../shared/logger"

const log = createLogger("workflows/launch-product/create-creator-bounty")

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
 * Take a launch's demand-post and its bounties out of public view: an
 * escrowed bounty is refunded (which cancels it), every other open one is
 * cancelled, then the post. Each part is attempted whatever the others do,
 * and a failure is logged: this runs when the launch is already failing.
 */
async function cancelLaunchDemand(container: MedusaContainer, demandPostId: string): Promise<void> {
  const service = container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
  try {
    const bounties = await service.listDemandBounties({ demand_post_id: demandPostId })
    for (const bounty of bounties) {
      if (bounty.status !== BountyStatus.ACTIVE && bounty.status !== BountyStatus.MILESTONE_PARTIAL) continue
      if (bounty.escrowed) {
        try {
          await getCollectiveHawalaService(container).refundBountyEscrow({
            demand_post_id: demandPostId,
            bounty_id: bounty.id,
          })
        } catch (err) {
          log.error(`[launch] escrow refund failed for bounty ${bounty.id} of cancelled launch post ${demandPostId}`, err)
        }
      }
      await service.updateDemandBounties({ id: bounty.id, status: BountyStatus.CANCELLED })
    }
  } catch (err) {
    log.error(`[launch] could not cancel the bounties of launch post ${demandPostId}`, err)
  }
  try {
    // Soft-cancel rather than hard-delete, matching the lifecycle enums.
    await service.transitionDemandStatus(demandPostId, DemandPostStatus.CANCELLED)
  } catch (err) {
    log.error(`[launch] could not cancel launch post ${demandPostId}`, err)
  }
}

/**
 * Creates the producer's demand-post (a coalition "need" when a cooperative is
 * attached) and a creator marketing bounty against it, then publishes the post
 * to OPEN so creators can discover and claim it. Idempotent per `launch_id`
 * and product.
 *
 * Nothing it makes outlives a failed launch as a public bounty: if the escrow
 * throws, or a later step does, the post and its bounties are cancelled.
 */
const createCreatorBountyStep = createStep(
  "create-creator-bounty-step",
  async (data: CreateCreatorBountyInput, { container }) => {
    const service = container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

    // Idempotency: reuse the demand-post this launch already made for this
    // product. A cancelled post is what a failed run left, and one pointing
    // at another product belongs to a run whose product is gone; reusing
    // either would hand back a launch that does not exist.
    const existingPosts = await service.listDemandPosts({
      launch_id: data.launch_id,
    })
    const reusable = existingPosts.find(
      (p) => p.status !== DemandPostStatus.CANCELLED && p.product_id === data.product_id
    )
    if (reusable) {
      const bounties = await service.listDemandBounties({
        demand_post_id: reusable.id,
      })
      return new StepResponse(
        {
          demand_post_id: reusable.id as string,
          bounty_id: (bounties[0]?.id ?? null) as string | null,
        },
        { created: false, demand_post_id: reusable.id as string }
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
      try {
        await hawala.escrowBountyFunds({
          demand_post_id: post.id,
          bounty_id: bounty.id,
          contributor_id: data.seller_id,
          amount: Number(data.bounty.amount),
        })
      } catch (err) {
        // A step that throws is not compensated, so its own writes are undone
        // here: the post was already OPEN and the bounty ACTIVE, advertising
        // a reward no money stood behind.
        await cancelLaunchDemand(container, post.id)
        throw err
      }
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
    await cancelLaunchDemand(container, comp.demand_post_id)
  }
)

export default createCreatorBountyStep
