import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/admin/marketplace/reward-pools/[id]/distribute")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_REWARDS_MODULE } from "../../../../../../../modules/creator-rewards"
import type CreatorRewardsService from "../../../../../../../modules/creator-rewards/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"
import {
  RewardPoolStatus,
} from "../../../../../../../modules/creator-rewards/models"

/**
 * POST /v1/admin/marketplace/reward-pools/:id/distribute
 *
 * Manually trigger pool distribution. Same engine that runs in the
 * scheduled job — admin can preview (?dry_run=1) or commit.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const dryRun =
    req.query.dry_run === "1" || req.query.dry_run === "true"

  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const pools = await rewards.listRewardPools({ id })
  const pool = pools[0]
  if (!pool) {
    return res.status(404).json({ message: "Pool not found", type: "not_found" })
  }
  if (
    pool.status === RewardPoolStatus.DISTRIBUTED ||
    pool.status === RewardPoolStatus.REVERTED
  ) {
    return res.status(409).json({
      message: `Pool is in terminal status: ${pool.status}`,
      type: "conflict",
    })
  }

  const result = await rewards.calculatePoolDistribution(id)
  if (dryRun) {
    return res.status(200).json({ dry_run: true, ...result })
  }

  const payouts = await rewards.persistDistribution(id, result)

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const currencyCode = String(pool.currency_code || "usd").toUpperCase()
  const succeeded: string[] = []
  for (const payout of payouts) {
    if (Number(payout.amount_cents) <= 0) continue
    try {
      const entry = await hawala.creditCreatorReward({
        poolId: id,
        creatorSellerId: payout.creator_seller_id,
        amountCents: Number(payout.amount_cents),
        rewardPayoutId: payout.id,
        currencyCode,
      })
      await rewards.markPayoutPaid(payout.id, entry.id)
      succeeded.push(payout.id)
    } catch (err) {
      log.error(
        `[admin/distribute] payout ${payout.id} failed`,
        err
      )
    }
  }
  await rewards.markPoolDistributed(id)

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    if (pool.funder_seller_id) {
      await webhooks.dispatch("creator.reward.distributed", pool.funder_seller_id, {
        pool_id: id,
        program_id: pool.program_id,
        total_distributed_cents: result.total_distributed_cents,
        creator_count: succeeded.length,
      })
    }
    for (const payout of payouts) {
      if (succeeded.includes(payout.id)) {
        await webhooks.dispatch("creator.reward.distributed", payout.creator_seller_id, {
          pool_id: id,
          payout_id: payout.id,
          amount_cents: Number(payout.amount_cents),
          qualified_views: Number(payout.qualified_views),
        })
      }
    }
  } catch (err) {
    log.error("[admin/distribute] webhook dispatch failed", err)
  }

  return res.status(200).json({
    pool_id: id,
    distributed_count: succeeded.length,
    total_payouts: payouts.length,
    total_distributed_cents: result.total_distributed_cents,
  })
}
