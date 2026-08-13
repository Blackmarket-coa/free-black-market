import { MedusaService } from "@medusajs/framework/utils"
import { createHmac, randomBytes, randomUUID } from "crypto"
import WebhookSubscription, {
  MARKETPLACE_WEBHOOK_EVENTS,
  MarketplaceWebhookEvent,
  WebhookSubscriptionStatus,
} from "./models/webhook-subscription"
import WebhookDelivery, {
  WebhookDeliveryStatus,
} from "./models/webhook-delivery"
import { isBlackoutEventType } from "./models/blackout-events"

const RETRY_BACKOFF_MINUTES = [1, 5, 30] as const
const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1

/**
 * Sentinel subscription id for the global Blackout outbound channel (§1).
 * Never a real DB row: it tells `attemptDelivery` to take the Blackout branch
 * (top-level envelope, raw-byte hex signing, x-fbm-* headers, single
 * config-driven destination) instead of the per-seller branch.
 */
export const BLACKOUT_SUBSCRIPTION_ID = "blackout-global"

/**
 * Sentinel subscription id for the global Blackstar outbound channel — the
 * FBM→Blackstar half of the federated-logistics bridge. Same idea as the
 * Blackout sentinel, but the wire format is Blackstar's documented contract
 * (`api/docs/events/freeblackmarket-contract.md` in the Blackstar repo):
 * envelope `{event_id, event_type, correlation_id, payload}`, signed with a
 * timestamped HMAC over `"{X-FBM-Timestamp}.{raw_body}"` so a captured
 * request cannot be replayed outside the tolerance window.
 */
export const BLACKSTAR_SUBSCRIPTION_ID = "blackstar-global"

/**
 * The three inbound event types Blackstar's InboundEventProcessor accepts.
 * Anything else dead-letters on their side, so the emitter refuses it here.
 */
export const BLACKSTAR_EVENT_TYPES = [
  "order.created",
  "delivery.option.selected",
  "order.cancelled",
] as const

export type BlackstarEventType = (typeof BLACKSTAR_EVENT_TYPES)[number]

export function isBlackstarEventType(type: string): type is BlackstarEventType {
  return (BLACKSTAR_EVENT_TYPES as readonly string[]).includes(type)
}

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
   * Enqueue one event for the global Blackout outbound channel (§1-§3).
   *
   * Builds the top-level envelope `{ eventId, type, occurredAt, [metadata],
   * ...fields }` exactly as the Blackout consumer expects (NOT the per-seller
   * `{id,event,seller_id,payload}` wrapper) and stores it as the delivery
   * payload. The dispatcher signs and ships it from `attemptDelivery`.
   *
   * Idempotency: `eventId` must be stable per logical event (e.g.
   * `purchase.succeeded:${orderId}`); a re-emit with the same id is a no-op.
   * No-ops entirely when the emitter is not configured (dev/preview without a
   * signing secret + destination), returning `null`.
   */
  async emitBlackout(
    type: string,
    fields: Record<string, unknown>,
    opts: { eventId?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<DispatchedDelivery | null> {
    if (!isBlackoutEventType(type)) {
      throw new Error(`Unknown Blackout event type: ${type}`)
    }
    if (!isBlackoutEmitConfigured()) {
      return null
    }

    const eventId = opts.eventId ?? randomUUID()

    // Stable-eventId dedupe: never enqueue the same logical event twice.
    const existing = await this.listWebhookDeliveries({ event_id: eventId })
    if (existing.length > 0) {
      return { id: existing[0].id, subscription_id: BLACKOUT_SUBSCRIPTION_ID }
    }

    const envelope: Record<string, unknown> = {
      eventId,
      type,
      occurredAt: new Date().toISOString(),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...fields,
    }

    const delivery = await (this as any).createWebhookDeliveries({
      subscription_id: BLACKOUT_SUBSCRIPTION_ID,
      event: type,
      event_id: eventId,
      payload: envelope,
      attempt: 0,
      status: WebhookDeliveryStatus.PENDING,
      next_attempt_at: new Date(),
    })
    const single = Array.isArray(delivery) ? delivery[0] : delivery
    return { id: single.id, subscription_id: BLACKOUT_SUBSCRIPTION_ID }
  }

  /**
   * Enqueue one event for the global Blackstar outbound channel. Envelope per
   * Blackstar's contract: `{event_id, event_type, correlation_id, payload}` —
   * fields nested under `payload`, unlike the Blackout channel's top-level
   * envelope. Idempotent on a stable eventId; no-ops (returns null) when the
   * channel is unconfigured so dev/preview never queues undeliverable rows.
   */
  async emitBlackstar(
    type: string,
    payload: Record<string, unknown>,
    opts: { eventId?: string; correlationId?: string } = {}
  ): Promise<DispatchedDelivery | null> {
    if (!isBlackstarEventType(type)) {
      throw new Error(`Unknown Blackstar event type: ${type}`)
    }
    if (!isBlackstarEmitConfigured()) {
      return null
    }

    const eventId = opts.eventId ?? randomUUID()

    const existing = await this.listWebhookDeliveries({ event_id: eventId })
    if (existing.length > 0) {
      return { id: existing[0].id, subscription_id: BLACKSTAR_SUBSCRIPTION_ID }
    }

    const envelope: Record<string, unknown> = {
      event_id: eventId,
      event_type: type,
      correlation_id: opts.correlationId ?? eventId,
      payload,
    }

    const delivery = await (this as any).createWebhookDeliveries({
      subscription_id: BLACKSTAR_SUBSCRIPTION_ID,
      event: type,
      event_id: eventId,
      payload: envelope,
      attempt: 0,
      status: WebhookDeliveryStatus.PENDING,
      next_attempt_at: new Date(),
    })
    const single = Array.isArray(delivery) ? delivery[0] : delivery
    return { id: single.id, subscription_id: BLACKSTAR_SUBSCRIPTION_ID }
  }

  /**
   * Attempt one delivery. Returns true on 2xx, false otherwise (and schedules
   * retry or marks dead).
   */
  async attemptDelivery(deliveryId: string): Promise<boolean> {
    const [delivery] = await this.listWebhookDeliveries({ id: deliveryId })
    if (!delivery) return false

    if (delivery.subscription_id === BLACKOUT_SUBSCRIPTION_ID) {
      return this.attemptBlackoutDelivery(delivery)
    }

    if (delivery.subscription_id === BLACKSTAR_SUBSCRIPTION_ID) {
      return this.attemptBlackstarDelivery(delivery)
    }

    return this.attemptSellerDelivery(delivery)
  }

  /**
   * Deliver a Blackstar-channel event: raw envelope as the body, timestamped
   * HMAC-SHA256 over `"{timestamp}.{raw_body}"` (computed fresh per attempt —
   * a signature computed at queue time would be stale by the retry), headers
   * X-FBM-Timestamp / X-FBM-Signature / X-Correlation-ID, single
   * config-driven destination. Shares the retry/backoff state machine.
   */
  private async attemptBlackstarDelivery(delivery: any): Promise<boolean> {
    const cfg = blackstarEmitConfig()
    if (!cfg) {
      // Config went away after enqueue — stay pending for a later drain.
      return false
    }

    const rawBody = JSON.stringify(delivery.payload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac("sha256", cfg.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")
    const url = `${cfg.apiBase.replace(/\/$/, "")}/api/webhooks/freeblackmarket`
    const attempt = (delivery.attempt ?? 0) + 1
    const correlationId = String(
      (delivery.payload as any)?.correlation_id ?? delivery.event_id ?? ""
    )

    let responseCode: number | null = null
    let responseBody: string | null = null
    let succeeded = false

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "X-FBM-Timestamp": timestamp,
      "X-FBM-Signature": signature,
      "X-Correlation-ID": correlationId,
    }
    // Per-partner machine credential announcement: the key id Blackstar issued
    // this deployment (its `fbm:credential issue` output). Optional until
    // Blackstar's FBM_REQUIRE_KEY_ID retires its global secret.
    const emitKeyId = process.env.BLACKSTAR_EMIT_KEY_ID
    if (emitKeyId) {
      headers["X-FBM-Key-ID"] = emitKeyId
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: rawBody,
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
      return true
    }

    await this.scheduleRetryOrDie(delivery.id, attempt, responseCode, responseBody)
    return false
  }

  /**
   * Deliver a Blackout-channel event (§1): top-level envelope as the raw body,
   * lowercase-hex HMAC-SHA256 over the exact bytes transmitted, x-fbm-event-id
   * / x-fbm-signature headers, single config-driven destination. Reuses the
   * shared retry/backoff state machine.
   */
  private async attemptBlackoutDelivery(delivery: any): Promise<boolean> {
    const cfg = blackoutEmitConfig()
    if (!cfg) {
      // Secret/destination went away after enqueue — leave pending for a later
      // drain rather than burning a retry attempt.
      return false
    }

    // Sign the EXACT bytes we transmit: same string to update() and fetch body.
    const rawBody = JSON.stringify(delivery.payload)
    const signature = createHmac("sha256", cfg.secret).update(rawBody).digest("hex")
    const url = `${cfg.apiBase.replace(/\/$/, "")}/v1/marketplace/webhooks/freeblackmarket`
    const attempt = (delivery.attempt ?? 0) + 1

    let responseCode: number | null = null
    let responseBody: string | null = null
    let succeeded = false

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fbm-event-id": String(delivery.event_id ?? ""),
          "x-fbm-signature": signature,
        },
        body: rawBody,
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
      return true
    }

    await this.scheduleRetryOrDie(delivery.id, attempt, responseCode, responseBody)
    return false
  }

  /** Per-seller delivery (unchanged contract: wrapped envelope, sha256= header). */
  private async attemptSellerDelivery(delivery: any): Promise<boolean> {
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

    await this.scheduleRetryOrDie(delivery.id, attempt, responseCode, responseBody)

    await (this as any).updateWebhookSubscriptions({
      id: subscription.id,
      failure_count: (subscription.failure_count ?? 0) + 1,
      last_attempt_at: new Date(),
    })

    return false
  }

  /**
   * Mark a failed attempt: schedule the next retry with exponential backoff,
   * or mark the delivery DEAD once attempts are exhausted. Shared by both the
   * per-seller and Blackout delivery branches.
   */
  private async scheduleRetryOrDie(
    deliveryId: string,
    attempt: number,
    responseCode: number | null,
    responseBody: string | null
  ): Promise<void> {
    const isFinalAttempt = attempt >= MAX_ATTEMPTS
    if (isFinalAttempt) {
      await (this as any).updateWebhookDeliveries({
        id: deliveryId,
        attempt,
        status: WebhookDeliveryStatus.DEAD,
        response_code: responseCode,
        response_body: responseBody,
        next_attempt_at: null,
      })
      return
    }
    const backoffMinutes = RETRY_BACKOFF_MINUTES[attempt - 1] ?? 30
    const next = new Date(Date.now() + backoffMinutes * 60_000)
    await (this as any).updateWebhookDeliveries({
      id: deliveryId,
      attempt,
      status: WebhookDeliveryStatus.FAILED,
      response_code: responseCode,
      response_body: responseBody,
      next_attempt_at: next,
    })
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

/**
 * Resolved config for the Blackout outbound channel, or null when either the
 * signing secret or the destination is missing. Read from the environment
 * directly (not the cached `config` singleton) so tests can flip it per-case.
 */
export function blackoutEmitConfig(): { secret: string; apiBase: string } | null {
  const secret = process.env.FREEBLACKMARKET_WEBHOOK_SECRET
  const apiBase = process.env.BLACKOUT_API_BASE
  if (!secret || !apiBase) return null
  return { secret, apiBase }
}

export function isBlackoutEmitConfigured(): boolean {
  return blackoutEmitConfig() !== null
}

/**
 * Resolved config for the Blackstar outbound channel, or null when either
 * the signing secret or the destination is missing. `BLACKSTAR_WEBHOOK_SECRET`
 * is the same value Blackstar reads as `FBM_WEBHOOK_SECRET` on its side.
 */
export function blackstarEmitConfig(): { secret: string; apiBase: string } | null {
  const secret = process.env.BLACKSTAR_WEBHOOK_SECRET
  const apiBase = process.env.BLACKSTAR_API_BASE
  if (!secret || !apiBase) return null
  return { secret, apiBase }
}

export function isBlackstarEmitConfigured(): boolean {
  return blackstarEmitConfig() !== null
}

export default MarketplaceWebhooksService
