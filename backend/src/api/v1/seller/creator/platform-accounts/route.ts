import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CONTENT_PLATFORM_MODULE } from "../../../../../modules/content-platform"
import type ContentPlatformService from "../../../../../modules/content-platform/service"
import type { ContentPlatform } from "../../../../../modules/content-platform/providers/types"

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

const ConnectNonOAuthSchema = z.object({
  platform: z.enum(PLATFORMS),
  external_account_id: z.string().min(1).max(256),
  handle: z.string().min(1).max(128).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

/**
 * GET /v1/seller/creator/platform-accounts
 *   List the creator's connected platform accounts.
 *
 * POST /v1/seller/creator/platform-accounts
 *   Connect a non-OAuth platform (rss, custom, podcast). For OAuth-based
 *   platforms (tiktok/instagram/youtube/twitch/blackout) use the
 *   /connect endpoint instead.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const cp = req.scope.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)
  const accounts = await cp.listPlatformAccounts({ creator_seller_id: sellerId })
  // Don't leak encrypted tokens to the client.
  return res.status(200).json({
    accounts: accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      external_account_id: a.external_account_id,
      handle: a.handle,
      display_name: a.display_name,
      avatar_url: a.avatar_url,
      follower_count: Number(a.follower_count ?? 0),
      status: a.status,
      last_synced_at: a.last_synced_at,
      inbound_webhook_secret: a.inbound_webhook_secret,
      metadata: a.metadata,
    })),
    available_platforms: cp.listAvailablePlatforms(),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = ConnectNonOAuthSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid connect payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const cp = req.scope.resolve<ContentPlatformService>(CONTENT_PLATFORM_MODULE)
  if (!cp.hasProvider(parsed.data.platform as ContentPlatform)) {
    return res.status(404).json({
      message: `Platform ${parsed.data.platform} is not enabled on this deployment`,
      type: "platform_disabled",
    })
  }
  const account = await cp.connectNonOAuth({
    creatorSellerId: sellerId,
    platform: parsed.data.platform as ContentPlatform,
    externalAccountId: parsed.data.external_account_id,
    handle: parsed.data.handle ?? null,
    metadata: (parsed.data.metadata as Record<string, unknown> | null) ?? undefined,
  })
  return res.status(201).json({ account })
}
