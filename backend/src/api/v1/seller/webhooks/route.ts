import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../middlewares/seller-context-v1"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../modules/marketplace-webhooks/service"
import { MARKETPLACE_WEBHOOK_EVENTS, WebhookSubscriptionStatus } from "../../../../modules/marketplace-webhooks/models/webhook-subscription"
import {
  getSellerPlanLimits,
  respondPlanLimitReached,
} from "../../../../shared/seller-plan"
import { hasRoomFor } from "../../../../modules/vendor-plan/limits"

const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const CreateSchema = z.object({
  url: httpsUrl,
  events: z
    .array(z.enum(MARKETPLACE_WEBHOOK_EVENTS))
    .min(1)
    .max(MARKETPLACE_WEBHOOK_EVENTS.length),
})

function redact(secret: string): string {
  if (!secret) return ""
  return `${secret.slice(0, 12)}...${secret.slice(-4)}`
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const service = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )
  const subs = await service.listWebhookSubscriptions(
    { seller_id: sellerId },
    { order: { created_at: "DESC" } }
  )

  return res.json({
    subscriptions: subs.map((s) => ({
      id: s.id,
      url: s.url,
      events: s.events,
      status: s.status,
      failure_count: s.failure_count,
      last_attempt_at: s.last_attempt_at,
      secret_preview: redact(s.secret),
    })),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid webhook payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE
  )

  // Endpoint count is the meter, not the event catalog. Every event in
  // MARKETPLACE_WEBHOOK_EVENTS belongs to one domain family (creator programs,
  // service contracts, subcontracts), so slicing it into tiers would be an
  // arbitrary line through a single integration — and would break subscriptions
  // that already reference the events it removed.
  const active = await service.listWebhookSubscriptions({
    seller_id: sellerId,
    status: WebhookSubscriptionStatus.ACTIVE,
  })
  const { plan_code, limits } = await getSellerPlanLimits(req.scope, sellerId)
  if (!hasRoomFor(active.length, limits.webhook_subscriptions)) {
    return respondPlanLimitReached(res, {
      limit_key: "webhook_subscriptions",
      limit: limits.webhook_subscriptions,
      current: active.length,
      plan_code,
      noun: "webhook endpoints",
    })
  }

  const created = await service.createSubscription({
    seller_id: sellerId,
    url: parsed.data.url,
    events: parsed.data.events,
  })
  const sub = Array.isArray(created) ? created[0] : created

  // Return the full secret ONCE on creation; subsequent reads are redacted.
  return res.status(201).json({
    subscription: {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      status: sub.status,
      secret: sub.secret,
    },
  })
}
