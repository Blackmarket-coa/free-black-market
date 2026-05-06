import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTENT_PLATFORM_MODULE } from "../../../../../modules/content-platform"
import type ContentPlatformService from "../../../../../modules/content-platform/service"
import type { ContentPlatform } from "../../../../../modules/content-platform/providers/types"
import { CREATOR_REWARDS_MODULE } from "../../../../../modules/creator-rewards"
import type CreatorRewardsService from "../../../../../modules/creator-rewards/service"

const SUPPORTED_PLATFORMS: ContentPlatform[] = [
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "blackout",
  "rss",
  "podcast",
  "custom",
]

/**
 * POST /v1/webhooks/content-platform/:platform
 *
 * Generic ingress for inbound platform webhooks. Per-platform HMAC
 * signature verification happens inside the matching adapter (and for
 * `custom`, against the per-account `inbound_webhook_secret`). Normalized
 * events are then upserted into `creator-rewards.EngagementSnapshot`.
 *
 * Authentication: none — adapters MUST verify their own signatures.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const platform = (req.params as { platform?: string })?.platform as
    | ContentPlatform
    | undefined
  if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
    return res.status(404).json({
      message: `Unknown platform: ${platform}`,
      type: "not_found",
    })
  }

  const cp = req.scope.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)
  if (!cp.hasProvider(platform)) {
    return res.status(404).json({
      message: `Platform ${platform} is not enabled on this deployment`,
      type: "platform_disabled",
    })
  }

  let events
  try {
    events = await cp.dispatchInbound({
      platform,
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody: (req as any).rawBody ?? null,
      body: req.body,
    })
  } catch (err) {
    return res.status(401).json({
      message: (err as Error).message,
      type: "unauthorized",
    })
  }

  if (events.length === 0) {
    return res.status(204).send("")
  }

  // Upsert engagement snapshots for any post.metrics_updated events that
  // reference a known content_post.
  let snapshotsCreated = 0
  try {
    const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
    for (const ev of events) {
      if (ev.type !== "post.metrics_updated" || !ev.externalPostId || !ev.metrics) continue
      const posts = await rewards.listContentPosts({
        platform,
        external_post_id: ev.externalPostId,
      })
      const post = posts[0]
      if (!post) continue
      await rewards.ingestSnapshot(post.id, {
        views: ev.metrics.views,
        qualifiedViews: ev.metrics.qualified_views ?? ev.metrics.views,
        likes: ev.metrics.likes,
        shares: ev.metrics.shares,
        comments: ev.metrics.comments,
        saves: ev.metrics.saves,
        watchTimeSeconds: ev.metrics.watch_time_seconds,
        raw: ev.raw,
        capturedAt: ev.occurredAt,
      })
      snapshotsCreated++
    }
  } catch (err) {
    console.error("[content-platform-webhook] snapshot ingest failed", err)
  }

  return res.status(200).json({
    received: events.length,
    snapshots_created: snapshotsCreated,
  })
}
