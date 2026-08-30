import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import {
  PLUGIN_EVENTS,
  pluginHookChannelId,
} from "../../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
// Author enforcement is shared with the deprecate route (W3).
import { resolveAuthorPlugin } from "../../author-guard"

const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const CreateSchema = z.object({
  url: httpsUrl,
  events: z.array(z.enum(PLUGIN_EVENTS)).min(1).max(PLUGIN_EVENTS.length),
})

function redact(secret: string): string {
  if (!secret) return ""
  return `${secret.slice(0, 12)}...${secret.slice(-4)}`
}

/**
 * GET /v1/seller/plugins/:slug/hooks
 * List the plugin's hook endpoints (author-only; secrets redacted).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const plugin = await resolveAuthorPlugin(req, res, sellerId)
  if (!plugin) return

  const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )
  const hooks = await webhooks.listWebhookSubscriptions(
    { seller_id: pluginHookChannelId(plugin.slug) },
    { order: { created_at: "DESC" } }
  )

  return res.json({
    hooks: hooks.map((h) => ({
      id: h.id,
      url: h.url,
      events: h.events,
      status: h.status,
      failure_count: h.failure_count,
      last_attempt_at: h.last_attempt_at,
      secret_preview: redact(h.secret),
    })),
  })
}

/**
 * POST /v1/seller/plugins/:slug/hooks
 *
 * Register a hook endpoint for the plugin (roadmap §1.4 event/hook registry).
 * The hook is stored as a webhook subscription on the plugin's synthetic
 * channel (`plugin:<slug>`) so delivery, HMAC signing (X-FBM-Signature with
 * the returned secret), retries, and draining reuse the marketplace-webhooks
 * machinery. The secret is returned ONCE.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const plugin = await resolveAuthorPlugin(req, res, sellerId)
  if (!plugin) return

  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid hook payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )
  const created = await webhooks.createSubscription({
    seller_id: pluginHookChannelId(plugin.slug),
    url: parsed.data.url,
    events: parsed.data.events,
  })
  const hook = Array.isArray(created) ? created[0] : created

  return res.status(201).json({
    hook: {
      id: hook.id,
      plugin_slug: plugin.slug,
      url: hook.url,
      events: hook.events,
      status: hook.status,
      secret: hook.secret,
    },
  })
}
