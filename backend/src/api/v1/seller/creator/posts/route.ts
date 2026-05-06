import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_REWARDS_MODULE } from "../../../../../modules/creator-rewards"
import type CreatorRewardsService from "../../../../../modules/creator-rewards/service"
import { CONTENT_PLATFORM_MODULE } from "../../../../../modules/content-platform"
import type ContentPlatformService from "../../../../../modules/content-platform/service"
import type { ContentPlatform } from "../../../../../modules/content-platform/providers/types"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"

const PLATFORMS = [
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "blackout",
  "rss",
  "podcast",
  "custom",
] as const

const RegisterSchema = z.object({
  platform: z.enum(PLATFORMS),
  external_post_id: z.string().min(1).max(256),
  external_url: z.string().url(),
  caption: z.string().max(4000).optional().nullable(),
  thumbnail_url: z.string().url().optional().nullable(),
  affiliate_link_id: z.string().min(1).max(64).optional().nullable(),
  deal_id: z.string().min(1).max(64).optional().nullable(),
  program_id: z.string().min(1).max(64).optional().nullable(),
})

/**
 * GET /v1/seller/creator/posts — list this creator's registered posts.
 * POST /v1/seller/creator/posts — register a new post. Best-effort
 * ownership verification is attempted via the matching content-platform
 * adapter; if it succeeds, the post is auto-marked verified.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const posts = await rewards.listContentPosts({ creator_seller_id: sellerId })
  return res.status(200).json({ posts })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = RegisterSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid post payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)

  let post = await rewards.registerPost({
    creatorSellerId: sellerId,
    platform: parsed.data.platform,
    externalPostId: parsed.data.external_post_id,
    externalUrl: parsed.data.external_url,
    caption: parsed.data.caption ?? null,
    thumbnailUrl: parsed.data.thumbnail_url ?? null,
    affiliateLinkId: parsed.data.affiliate_link_id ?? null,
    dealId: parsed.data.deal_id ?? null,
    programId: parsed.data.program_id ?? null,
  })

  // Best-effort ownership verification.
  try {
    const cp = req.scope.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)
    if (cp.hasProvider(parsed.data.platform as ContentPlatform)) {
      const ok = await cp.verifyPostOwnership({
        platform: parsed.data.platform as ContentPlatform,
        creatorSellerId: sellerId,
        externalPostId: parsed.data.external_post_id,
      })
      if (ok) {
        post = await rewards.verifyPost(post.id, "oauth")
      }
    }
  } catch (err) {
    console.error("[posts/register] verifyPostOwnership failed", err)
  }

  // Best-effort webhook
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    await webhooks.dispatch("creator.post.registered", sellerId, {
      post_id: post.id,
      platform: parsed.data.platform,
      external_post_id: parsed.data.external_post_id,
      external_url: parsed.data.external_url,
      verification_status: post.verification_status,
    })
    if (post.verification_status === "verified") {
      await webhooks.dispatch("creator.post.verified", sellerId, {
        post_id: post.id,
        platform: parsed.data.platform,
        external_post_id: parsed.data.external_post_id,
      })
    }
  } catch (err) {
    console.error("[posts/register] webhook dispatch failed", err)
  }

  return res.status(201).json({ post })
}
