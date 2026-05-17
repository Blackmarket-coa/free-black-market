import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { CONTENT_PLATFORM_MODULE } from "../../../../../../modules/content-platform"
import type ContentPlatformService from "../../../../../../modules/content-platform/service"
import type { ContentPlatform } from "../../../../../../modules/content-platform/providers/types"

const Schema = z.object({
  platform: z.enum(["tiktok", "instagram", "youtube", "twitch", "blackout"]),
  redirect_uri: z.string().url(),
})

/**
 * POST /v1/seller/creator/platform-accounts/connect
 *
 * Begin OAuth for an OAuth-based platform. Returns the auth URL and a
 * `state` value the client should set as a short-lived cookie before
 * redirecting; the matching callback endpoint will round-trip it.
 *
 * Non-OAuth platforms (rss, custom, podcast) should use POST
 * /v1/seller/creator/platform-accounts directly.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
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
  try {
    const result = await cp.startOAuth({
      creatorSellerId: sellerId,
      platform: parsed.data.platform as ContentPlatform,
      redirectUri: parsed.data.redirect_uri,
    })
    return res.status(200).json(result)
  } catch (err) {
    return res.status(400).json({
      message: (err as Error).message,
      type: "provider_error",
    })
  }
}
