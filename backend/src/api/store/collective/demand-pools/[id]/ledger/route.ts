import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/ledger")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { buildPoolLedgerTrail } from "../../../../../../lib/pool-ledger-trail"

/**
 * GET /store/collective/demand-pools/:id/ledger
 *
 * The money trail for a pool's escrow: every entry in and out, whether each one
 * has been settled into a Stellar batch, and the on-chain anchor when it has.
 *
 * Public because that is the point. A trail only visible to the people already
 * inside the pool is not much of a trust mechanism — the claim being made is
 * that an outsider can check where pooled money went. It exposes no account
 * ids, no running balances and no member identities (see
 * `lib/pool-ledger-trail.ts`), so what is public is what the pool did, not who
 * did it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand pool not found" })
    }
    const post = posts[0]

    // Non-public pools keep their trail private: publishing one would leak the
    // existence and size of a NETWORK_ONLY or INVITE_ONLY buy to anyone who
    // guessed its id.
    if (post.visibility !== "PUBLIC") {
      return res.status(404).json({ error: "Demand pool not found" })
    }

    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(
      HAWALA_LEDGER_MODULE
    )

    // Pool-level entries reference the post; bounty entries reference the
    // bounty. Both are this pool's money, so the trail needs both.
    const bounties = await demandPoolService.listDemandBounties({
      demand_post_id: id,
    })
    const bountyIds = new Set<string>(bounties.map((b) => b.id as string))

    const referenceIds = [id, ...bountyIds]
    const entries = await hawalaService.listLedgerEntries({
      reference_id: referenceIds,
    })

    const batchIds = Array.from(
      new Set(
        entries
          .map((e) => (e as { settlement_batch_id?: string }).settlement_batch_id)
          .filter((v): v is string => Boolean(v))
      )
    )
    const batches = batchIds.length
      ? await hawalaService.listSettlementBatches({ id: batchIds })
      : []
    const batchesById = new Map(batches.map((b) => [b.id as string, b as never]))

    const trail = buildPoolLedgerTrail({
      demandPostId: id,
      escrowAccountId: (post.escrow_account_id as string | null) ?? null,
      entries: entries as never[],
      batchesById,
      bountyIds,
    })

    res.json(trail)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to build ledger trail"
    log.error(`[GET /store/collective/demand-pools/${id}/ledger] Error:`, message)
    res.status(500).json({ error: "Failed to retrieve ledger trail" })
  }
}
