import { createLogger } from "../shared/logger"
const log = createLogger("jobs/creator-rewards-pool-close")
import { MedusaContainer } from "@medusajs/framework/types"
import { CREATOR_REWARDS_MODULE } from "../modules/creator-rewards"
import type CreatorRewardsService from "../modules/creator-rewards/service"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Daily scheduled job: find any reward pool whose `period_end` has passed
 * and that is still `accruing` or `scheduled`, calculate the per-creator
 * distribution from cumulative qualified-view counts, persist payouts, and
 * credit creator earnings via `hawala-ledger.creditCreatorReward`.
 */
export default async function creatorRewardsPoolCloseJob(container: MedusaContainer) {
  const rewards = container.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const hawala = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  let webhooks: MarketplaceWebhooksService | null = null
  try {
    webhooks = container.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  } catch {
    webhooks = null
  }

  const due = await rewards.listPoolsDueForDistribution()
  if (due.length === 0) return
  log.info(`[creator-rewards-pool-close] processing ${due.length} due pools`)

  for (const pool of due) {
    try {
      const result = await rewards.calculatePoolDistribution(pool.id)
      if (result.total_distributed_cents === 0) {
        log.info(`[creator-rewards-pool-close] no eligible creators in pool ${pool.id}`)
        await rewards.markPoolDistributed(pool.id)
        continue
      }
      const payouts = await rewards.persistDistribution(pool.id, result)
      const currency = String(pool.currency_code || "usd").toUpperCase()
      for (const payout of payouts) {
        if (Number(payout.amount_cents) <= 0) continue
        try {
          const entry = await hawala.creditCreatorReward({
            poolId: pool.id,
            creatorSellerId: payout.creator_seller_id,
            amountCents: Number(payout.amount_cents),
            rewardPayoutId: payout.id,
            currencyCode: currency,
          })
          await rewards.markPayoutPaid(payout.id, entry.id)

          if (webhooks) {
            try {
              await webhooks.dispatch(
                "creator.reward.distributed",
                payout.creator_seller_id,
                {
                  pool_id: pool.id,
                  payout_id: payout.id,
                  amount_cents: Number(payout.amount_cents),
                  qualified_views: Number(payout.qualified_views),
                }
              )
            } catch (err) {
              log.error(
                `[creator-rewards-pool-close] webhook failed for ${payout.id}`,
                err
              )
            }
          }
        } catch (err) {
          log.error(
            `[creator-rewards-pool-close] payout ${payout.id} failed`,
            err
          )
        }
      }
      await rewards.markPoolDistributed(pool.id)

      if (webhooks && pool.funder_seller_id) {
        try {
          await webhooks.dispatch(
            "creator.reward.distributed",
            pool.funder_seller_id,
            {
              pool_id: pool.id,
              program_id: pool.program_id,
              total_distributed_cents: result.total_distributed_cents,
              creator_count: result.per_creator.length,
            }
          )
        } catch (err) {
          log.error(
            `[creator-rewards-pool-close] funder webhook failed`,
            err
          )
        }
      }
    } catch (err) {
      log.error(`[creator-rewards-pool-close] pool ${pool.id} failed`, err)
    }
  }
}

export const config = {
  name: "creator-rewards-pool-close",
  schedule: "30 1 * * *", // daily at 01:30 UTC, after settlement
}
