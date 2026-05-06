import { MedusaContainer } from "@medusajs/framework/types"
import { CREATOR_REWARDS_MODULE } from "../modules/creator-rewards"
import type CreatorRewardsService from "../modules/creator-rewards/service"
import { CONTENT_PLATFORM_MODULE } from "../modules/content-platform"
import type ContentPlatformService from "../modules/content-platform/service"
import type { ContentPlatform } from "../modules/content-platform/providers/types"
import {
  ContentPostVerificationStatus,
} from "../modules/creator-rewards/models"

const POLL_BATCH_SIZE = 100

/**
 * Pull metrics every 15 minutes for verified content posts whose platform
 * adapter supports `fetchPostMetrics` (TikTok, Instagram, YouTube, Twitch,
 * Blackout). Adapters that don't support pull-mode (rss, custom) are
 * silently skipped — those rely on inbound webhook ingest instead.
 */
export default async function contentPlatformMetricsPollJob(
  container: MedusaContainer
) {
  const rewards = container.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const cp = container.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)

  const posts = await rewards.listContentPosts({
    verification_status: ContentPostVerificationStatus.VERIFIED,
    qualified: true,
  })

  let attempted = 0
  let updated = 0
  let skipped = 0
  for (const post of posts.slice(0, POLL_BATCH_SIZE) as any[]) {
    if (!cp.hasProvider(post.platform as ContentPlatform)) {
      skipped++
      continue
    }
    attempted++
    try {
      const metrics = await cp.fetchPostMetrics({
        platform: post.platform as ContentPlatform,
        creatorSellerId: post.creator_seller_id,
        externalPostId: post.external_post_id,
      })
      await rewards.ingestSnapshot(post.id, {
        views: metrics.views,
        qualifiedViews: metrics.qualified_views ?? metrics.views,
        likes: metrics.likes,
        shares: metrics.shares,
        comments: metrics.comments,
        saves: metrics.saves,
        watchTimeSeconds: metrics.watch_time_seconds,
        raw: metrics.raw,
      })
      updated++
    } catch (err) {
      // Adapter may throw `ProviderNotSupportedError` for pull-mode-not-
      // supported platforms (rss/custom) or transient HTTP errors. Either
      // way, don't crash the job — just log and move on.
      const msg = (err as Error).message || ""
      if (msg.includes("not support")) {
        skipped++
      } else {
        console.error(
          `[content-platform-metrics-poll] post ${post.id} failed`,
          err
        )
      }
    }
  }

  if (attempted > 0 || updated > 0) {
    console.log(
      `[content-platform-metrics-poll] attempted=${attempted} updated=${updated} skipped=${skipped}`
    )
  }
}

export const config = {
  name: "content-platform-metrics-poll",
  schedule: "*/15 * * * *", // every 15 minutes
}
