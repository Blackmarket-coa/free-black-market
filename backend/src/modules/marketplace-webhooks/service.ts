import { MedusaService } from "@medusajs/framework/utils"
import { createHmac, randomBytes } from "crypto"
import WebhookSubscription, {
  MARKETPLACE_WEBHOOK_EVENTS,
  MarketplaceWebhookEvent,
  WebhookSubscriptionStatus,
} from "./models/webhook-subscription"
import WebhookDelivery, {
  WebhookDeliveryStatus,
} from "./models/webhook-delivery"

const RETRY_BACKOFF_MINUTES = [1, 5, 30] as const
const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1

export interface DispatchedDelivery {
  id: string
  subscription_id: string
}

class MarketplaceWebhooksService extends MedusaService({
  WebhookSubscription,
  WebhookDelivery,
}) {
  isKnownEvent(event: string): event is MarketplaceWebhookEvent {
    return (MARKETPLACE_WEBHOOK_EVENTS as readonly string[]).includes(event)
  }

  generateSecret(): string {
    return `fbm_whsec_${randomBytes(24).toString("hex")}`
  }

  async createSubscription(args: {
    seller_id: string
    url: string
    events: string[]
    secret?: string
  }) {
    const secret = args.secret ?? this.generateSecret()
    return (this as any).createWebhookSubscriptions({
      seller_id: args.seller_id,
      url: args.url,
      events: args.events,
      secret,
      status: WebhookSubscriptionStatus.ACTIVE,
      failure_count: 0,
    })
  }

  /**
   * Enqueue a delivery for every subscription on the given seller that
   * subscribes to `event`. Caller is responsible for supplying the payload —
   * the dispatcher signs it with the per-subscription secret at delivery time.
   */
  async dispatch(
    event: MarketplaceWebhookEvent | string,
    sellerId: string,
    payload: Record<string, unknown>
  ): Promise<DispatchedDelivery[]> {
    const subscriptions = await this.listWebhookSubscriptions({
      seller_id: sellerId,
      status: WebhookSubscriptionStatus.ACTIVE,
    })

    const matching = subscriptions.filter((s) => {
      const events = (s.events as unknown as string[] | null) ?? []
      return Array.isArray(events) && (events.includes(event) || events.includes("*"))
    })

    if (matching.length === 0) return []

    const created = await Promise.all(
      matching.map(async (s) => {
        const delivery = await (this as any).createWebhookDeliveries({
          subscription_id: s.id,
          event,
          payload,
          attempt: 0,
          status: WebhookDeliveryStatus.PENDING,
          next_attempt_at: new Date(),
        })
        const single = Array.isArray(delivery) ? delivery[0] : delivery
        return { id: single.id, subscription_id: s.id }
      })
    )

    return created
  }

  /**
   * Attempt one delivery. Returns true on 2xx, false otherwise (and schedules
   * retry or marks dead).
   */
  async attemptDelivery(deliveryId: string): Promise<boolean> {
    const [delivery] = await this.listWebhookDeliveries({ id: deliveryId })
    if (!delivery) return false

    const [subscription] = await this.listWebhookSubscriptions({
      id: delivery.subscription_id,
    })
    if (!subscription) {
      await (this as any).updateWebhookDeliveries({
        id: delivery.id,
        status: WebhookDeliveryStatus.DEAD,
      })
      return false
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      seller_id: subscription.seller_id,
      payload: delivery.payload,
      created_at: new Date().toISOString(),
    })

    const signature = signWithSecret(subscription.secret, body)
    const attempt = (delivery.attempt ?? 0) + 1

    let responseCode: number | null = null
    let responseBody: string | null = null
    let succeeded = false

    try {
      const res = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FBM-Event": delivery.event,
          "X-FBM-Delivery": delivery.id,
          "X-FBM-Signature": `sha256=${signature}`,
        },
        body,
      })
      responseCode = res.status
      responseBody = (await res.text()).slice(0, 2000)
      succeeded = res.ok
    } catch (err) {
      responseBody = err instanceof Error ? err.message.slice(0, 2000) : "fetch_error"
    }

    if (succeeded) {
      await (this as any).updateWebhookDeliveries({
        id: delivery.id,
        attempt,
        status: WebhookDeliveryStatus.SUCCEEDED,
        response_code: responseCode,
        response_body: responseBody,
        delivered_at: new Date(),
        next_attempt_at: null,
      })
      await (this as any).updateWebhookSubscriptions({
        id: subscription.id,
        failure_count: 0,
        last_attempt_at: new Date(),
      })
      return true
    }

    const isFinalAttempt = attempt >= MAX_ATTEMPTS
    if (isFinalAttempt) {
      await (this as any).updateWebhookDeliveries({
        id: delivery.id,
        attempt,
        status: WebhookDeliveryStatus.DEAD,
        response_code: responseCode,
        response_body: responseBody,
        next_attempt_at: null,
      })
    } else {
      const backoffMinutes = RETRY_BACKOFF_MINUTES[attempt - 1] ?? 30
      const next = new Date(Date.now() + backoffMinutes * 60_000)
      await (this as any).updateWebhookDeliveries({
        id: delivery.id,
        attempt,
        status: WebhookDeliveryStatus.FAILED,
        response_code: responseCode,
        response_body: responseBody,
        next_attempt_at: next,
      })
    }

    await (this as any).updateWebhookSubscriptions({
      id: subscription.id,
      failure_count: (subscription.failure_count ?? 0) + 1,
      last_attempt_at: new Date(),
    })

    return false
  }

  /**
   * Pull deliveries that are due (status pending OR failed-with-due-retry)
   * and attempt them. Intended to be called from a scheduled job.
   */
  async drainDueDeliveries(limit = 25): Promise<number> {
    const now = new Date()
    const due = await this.listWebhookDeliveries(
      {
        $or: [
          { status: WebhookDeliveryStatus.PENDING },
          {
            status: WebhookDeliveryStatus.FAILED,
            next_attempt_at: { $lte: now },
          },
        ],
      },
      { take: limit, order: { next_attempt_at: "ASC" } }
    )

    let attempted = 0
    for (const d of due) {
      await this.attemptDelivery(d.id)
      attempted++
    }
    return attempted
  }
}

export function signWithSecret(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex")
}

export default MarketplaceWebhooksService
