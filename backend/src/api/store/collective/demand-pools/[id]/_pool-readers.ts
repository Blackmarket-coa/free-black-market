import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../../../modules/demand-pool/service"
import { actorId, actorIsAnyOf } from "../../../../../shared/community-read-access"

/**
 * Who may read a demand pool's rows, and how much of each (SD-118 follow-up).
 *
 * `GET .../proposals`, `.../bounties` and `.../barter` are public reads
 * (`store/collective/_middlewares.ts`: "Reads stay public"), and returned
 * every row whole for any pool, whatever its visibility. The pool's own page
 * had stopped serving those rows to strangers; these three served them one
 * URL away. They now share one rule, the detail route's:
 *
 * - **The pool's creator** reads every row whole: they choose the supplier,
 *   accept the trade and release the bounty.
 * - **The people a row is about** read that row whole: a bounty's
 *   contributor and assignee, a trade's proposer. That is the D10-5 ruling's
 *   first tier (`shared/community-read-access.ts`), and the people the
 *   bounty route already let read a RESTRICTED bounty.
 * - **Anyone else** reads the public terms of each row
 *   (`modules/demand-pool/public-view.ts`), participants included: whether a
 *   pool's participants should read the suppliers' notes and terms they
 *   vote on is an operator's decision, and until it is made they do not.
 *
 * And which pools. A pool that is not PUBLIC lists its rows only to its
 * creator and its participants; anyone else is answered as `/ledger`
 * answers them, 404 "Demand pool not found", the same body as for an id
 * that names no pool, so the status says nothing about which ids are real.
 * Someone outside such a pool who is on one of its rows (they claimed a
 * bounty, or offered a trade) reads that row and no other.
 */

const NOT_FOUND = { error: "Demand pool not found" }

/** The one refusal: a missing pool and a pool the caller may not list read the same. */
export function poolNotFound(res: MedusaResponse): void {
  res.status(404).json(NOT_FOUND)
}

export type PoolReader = {
  /** The pool's creator: every row whole. */
  creator: boolean
  /** The pool is PUBLIC, or the caller is its creator or one of its participants. */
  listed: boolean
  /** True when one of `ids` is the caller: the people a row is about read it whole. */
  isCaller: (...ids: Array<string | null | undefined>) => boolean
}

/**
 * Reads the pool named by `:id` and decides who is asking. Answers 404 and
 * returns null when there is no such pool.
 */
export async function resolvePoolReader(req: MedusaRequest, res: MedusaResponse): Promise<PoolReader | null> {
  const id = req.params.id
  const service = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
  const [post] = await service.listDemandPosts({ id })
  if (!post) {
    poolNotFound(res)
    return null
  }

  const creator = actorIsAnyOf(req, post.creator_id)
  let listed = creator || post.visibility === "PUBLIC"
  const caller = actorId(req)
  if (!listed && caller) {
    // Any participant row counts, as a garden membership does in
    // `actorIsGardenMember`: the question is whether they are part of the
    // pool, not whether their pledge is in good standing.
    const participants = await service.listDemandParticipants({ demand_post_id: id, customer_id: caller })
    listed = participants.length > 0
  }

  return {
    creator,
    listed,
    isCaller: (...ids) => actorIsAnyOf(req, ...ids),
  }
}
