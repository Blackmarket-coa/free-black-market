import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import DemandPoolModuleService from "../../../modules/demand-pool/service"
import { DEMAND_POOL_MODULE } from "../../../modules/demand-pool"
import { BountyStatus } from "../../../modules/demand-pool/models/demand-bounty"
import { DemandPostStatus } from "../../../modules/demand-pool/models/demand-post"
import { getCollectiveHawalaService } from "../../../services/collective-hawala"
import { assertFundedLaunchesLive } from "../../../modules/hawala-ledger/vendor-transfer-switches"
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
 * Nothing it makes outlives a failed launch as a public bounty: if any part of
 * it throws (the post, its publication, the bounty, the escrow), or a later
 * step does, the post and its bounties are cancelled. A funded bounty is
 * refused before anything is written unless FBM_FUNDED_LAUNCHES_LIVE=1.
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

    // A funded bounty is a funded launch, off unless FBM_FUNDED_LAUNCHES_LIVE=1.
    // escrowBountyFunds refuses it whatever calls it; asking first here means a
    // refused launch writes no post at all, rather than a cancelled one.
    const funded = Number(data.bounty.amount) > 0
    if (funded) assertFundedLaunchesLive()

    // Everything this step writes is undone here if any part of it throws: a
    // step that throws is not compensated. Before, only the escrow was
    // covered, so a bounty refused by addBounty (milestones not summing to
    // 100) left the post OPEN with no bounty, pointing at a product the
    // rollback deleted, and a retry added a second post beside it.
    let postId: string | null = null
    try {
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
      postId = post.id as string

      // Publish DRAFT -> OPEN so the bounty is discoverable.
      await service.publishDemandPost(postId)

      const bounty = await service.addBounty({
        demand_post_id: postId,
        contributor_id: data.seller_id,
        contributor_type: "SELLER",
        objective: data.bounty.objective,
        amount: data.bounty.amount,
        currency_code: data.bounty.currency_code ?? "USD",
        milestones: data.bounty.milestones,
      })

      // A funded bounty must be backed by escrow so the displayed reward is
      // real: the amount moves from the seller's wallet into the pool escrow.
      if (funded) {
        await getCollectiveHawalaService(container).escrowBountyFunds({
          demand_post_id: postId,
          bounty_id: bounty.id,
          contributor_id: data.seller_id,
          amount: Number(data.bounty.amount),
        })
      }

      return new StepResponse(
        {
          demand_post_id: postId,
          bounty_id: bounty.id as string,
        },
        { created: true, demand_post_id: postId }
      )
    } catch (err) {
      if (postId) await cancelLaunchDemand(container, postId)
      throw err
    }
  },
  async (comp, { container }) => {
    if (!comp || !comp.created || !comp.demand_post_id) {
      return
    }
    await cancelLaunchDemand(container, comp.demand_post_id)
  }
)

export default createCreatorBountyStep
