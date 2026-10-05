import { ContainerRegistrationKeys, MedusaService } from "@medusajs/framework/utils"
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
import {
  BLACK_MASK_CLAIM_LEASE_MS,
  BLACK_MASK_FETCH_TIMEOUT_MS,
  BLACK_MASK_SUBSCRIPTION_ID,
  blackMaskEventId,
  blackMaskProvisioningConfig,
  blackMaskRetryDelayMinutes,
  buildBlackMaskWireBody,
  deliverableEmail,
  isBlackMaskProvisioningEnabled,
  isBlackMaskStoredPayload,
  signBlackMaskBody,
  type BlackMaskConfig,
  type BlackMaskCustomerLookup,
  type BlackMaskStoredPayload,
} from "./black-mask"

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
 * The inbound event types Blackstar's InboundEventProcessor accepts. Anything
 * else dead-letters on their side, so the emitter refuses it here.
 */
export const BLACKSTAR_EVENT_TYPES = [
  "order.created",
  "delivery.option.selected",
  "order.cancelled",
  "node.operator.approved",
] as const

export type BlackstarEventType = (typeof BLACKSTAR_EVENT_TYPES)[number]

export function isBlackstarEventType(type: string): type is BlackstarEventType {
  return (BLACKSTAR_EVENT_TYPES as readonly string[]).includes(type)
}

type PgRaw = {
  raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> } | undefined>
}

type KnexHolder = { getConnection?: () => { getKnex?: () => PgRaw | undefined } | undefined }

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
   * Outbound Blackstar deliveries by status — the operator's view of the
   * bridge's health.
   *
   * Before this existed a delivery that exhausted its retries went DEAD in
   * `marketplace_webhook_delivery` and nothing surfaced it: no admin route, no
   * alert, no count. A Blackstar listing that was never created because FBM's
   * four attempts all hit a 5xx was indistinguishable, from any screen, from
   * one that was never meant to be. The inbound direction got a receipt table
   * and an ordering guard on 2026-09-03; this is the outbound direction
   * getting its first pair of eyes.
   */
  async listBlackstarDeliveries(args: {
    status?: WebhookDeliveryStatus | WebhookDeliveryStatus[]
    limit?: number
  } = {}) {
    const filters: Record<string, unknown> = {
      subscription_id: BLACKSTAR_SUBSCRIPTION_ID,
    }
    if (args.status) filters.status = args.status
    return this.listWebhookDeliveries(filters, {
      order: { created_at: "DESC" },
      take: Math.min(Math.max(1, args.limit ?? 50), 200),
    })
  }

  /**
   * Put a DEAD or FAILED Blackstar delivery back on the queue.
   *
   * Resets the attempt counter rather than continuing it: a delivery that
   * died after four attempts against a Blackstar that was down for an hour
   * deserves a fresh four, not a fifth that dies again on the next transient.
   * The envelope and its `event_id` are untouched, so Blackstar's receipt
   * table dedupes a replay of something it did in fact receive — replaying is
   * always safe from FBM's side, which is what makes an operator button
   * defensible at all.
   *
   * Refuses a SUCCEEDED delivery: replaying one that landed is not a retry,
   * it is a duplicate, and the fact that Blackstar would dedupe it is not a
   * reason to send it.
   */
  async replayBlackstarDelivery(
    deliveryId: string,
    opts: { attemptNow?: boolean } = {}
  ): Promise<{ delivery: unknown; attempted: boolean; succeeded: boolean | null }> {
    const [delivery] = await this.listWebhookDeliveries({ id: deliveryId })
    if (!delivery) throw new Error(`No delivery ${deliveryId}`)
    if (delivery.subscription_id !== BLACKSTAR_SUBSCRIPTION_ID) {
      throw new Error(`Delivery ${deliveryId} is not a Blackstar delivery`)
    }
    if (delivery.status === WebhookDeliveryStatus.SUCCEEDED) {
      throw new Error(`Delivery ${deliveryId} already succeeded; replaying it would duplicate it`)
    }

    await (this as any).updateWebhookDeliveries({
      id: delivery.id,
      attempt: 0,
      status: WebhookDeliveryStatus.PENDING,
      next_attempt_at: new Date(),
      response_code: null,
      response_body: null,
    })

    let succeeded: boolean | null = null
    if (opts.attemptNow) {
      succeeded = await this.attemptDelivery(delivery.id)
    }

    const [fresh] = await this.listWebhookDeliveries({ id: delivery.id })
    return { delivery: fresh, attempted: !!opts.attemptNow, succeeded }
  }

  /**
   * Enqueue one Black Mask provisioning notice (F3).
   *
   * No-op (null) unless FF_BLACK_MASK_PROVISIONING_V1 is on AND the channel
   * config is complete; the caller has already decided the subject is a vault
   * order or subscription. The row's `event_id` is the payload's
   * (subject, event, sequence) key, recomputed here so a caller cannot store a
   * key that did not come from the record. A duplicate enqueue returns the
   * existing row; the partial unique index on `event_id` backstops the
   * check-then-insert when two enqueues race.
   */
  async emitBlackMask(payload: BlackMaskStoredPayload): Promise<DispatchedDelivery | null> {
    if (!isBlackMaskProvisioningEnabled() || !blackMaskProvisioningConfig()) {
      return null
    }
    if (!isBlackMaskStoredPayload(payload)) {
      throw new Error("Malformed Black Mask provisioning payload")
    }
    const eventId = blackMaskEventId(payload.subject, payload.event, payload.sequence)
    if (payload.event_id !== eventId) {
      throw new Error(`Black Mask event_id ${payload.event_id} does not match its record (${eventId})`)
    }

    const existing = await this.listWebhookDeliveries({ event_id: eventId })
    if (existing.length > 0) {
      return { id: existing[0].id, subscription_id: BLACK_MASK_SUBSCRIPTION_ID }
    }

    try {
      const created = await this.createWebhookDeliveries({
        subscription_id: BLACK_MASK_SUBSCRIPTION_ID,
        event: `black_mask.${payload.event}`,
        event_id: eventId,
        payload: { ...payload } as Record<string, unknown>,
        attempt: 0,
        status: WebhookDeliveryStatus.PENDING,
        next_attempt_at: new Date(),
      })
      return { id: created.id, subscription_id: BLACK_MASK_SUBSCRIPTION_ID }
    } catch (err) {
      // Lost the race to a concurrent enqueue of the same key: the unique
      // index refused the second row, which is the dedupe working.
      const [winner] = await this.listWebhookDeliveries({ event_id: eventId })
      if (winner) return { id: winner.id, subscription_id: BLACK_MASK_SUBSCRIPTION_ID }
      throw err
    }
  }

  /** Black Mask deliveries by status, newest first: the operator's view. */
  async listBlackMaskDeliveries(args: {
    status?: WebhookDeliveryStatus | WebhookDeliveryStatus[]
    limit?: number
  } = {}) {
    const filters: Record<string, unknown> = {
      subscription_id: BLACK_MASK_SUBSCRIPTION_ID,
    }
    if (args.status) filters.status = args.status
    return this.listWebhookDeliveries(filters, {
      order: { created_at: "DESC" },
      take: Math.min(Math.max(1, args.limit ?? 50), 200),
    })
  }

  /**
   * Put a DEAD Black Mask delivery back on the queue: status pending, attempt
   * counter reset to 0 (a fresh ladder), due now. The next drain claims and
   * sends it. Only DEAD rows: a pending or failed row is already on its
   * ladder, and a succeeded one would be a duplicate, not a retry. The
   * payload and its event_id are untouched, so the receiver's dedupe applies.
   */
  async replayBlackMaskDelivery(deliveryId: string) {
    const [delivery] = await this.listWebhookDeliveries({ id: deliveryId })
    if (!delivery) throw new Error(`No delivery ${deliveryId}`)
    if (delivery.subscription_id !== BLACK_MASK_SUBSCRIPTION_ID) {
      throw new Error(`Delivery ${deliveryId} is not a Black Mask delivery`)
    }
    if (delivery.status !== WebhookDeliveryStatus.DEAD) {
      throw new Error(`Delivery ${deliveryId} is ${delivery.status}, not dead; only a dead delivery can be replayed`)
    }

    await this.updateWebhookDeliveries({
      id: delivery.id,
      attempt: 0,
      status: WebhookDeliveryStatus.PENDING,
      next_attempt_at: new Date(),
      response_code: null,
      response_body: null,
    })

    const [fresh] = await this.listWebhookDeliveries({ id: delivery.id })
    return fresh
  }

  /**
   * Send due Black Mask deliveries. Returns zero without touching a row when
   * the flag is off or the config is incomplete: rows stay pending and no
   * attempt is burned (the Blackstar precedent).
   *
   * Every row is claimed before it is sent (claimBlackMaskDelivery), so two
   * overlapping drains cannot both send it. `lookupCustomer` is the send-time
   * customer read for the `placed` invite; this module cannot reach the
   * customer module itself.
   */
  async drainBlackMaskDeliveries(opts: {
    lookupCustomer: BlackMaskCustomerLookup
    limit?: number
  }): Promise<{ attempted: number; sent: number }> {
    if (!isBlackMaskProvisioningEnabled()) return { attempted: 0, sent: 0 }
    const cfg = blackMaskProvisioningConfig()
    if (!cfg) return { attempted: 0, sent: 0 }

    const now = new Date()
    const due = await this.listWebhookDeliveries(
      {
        subscription_id: BLACK_MASK_SUBSCRIPTION_ID,
        status: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.FAILED],
        next_attempt_at: { $lte: now },
      },
      { take: Math.min(Math.max(1, opts.limit ?? 25), 100), order: { next_attempt_at: "ASC" } }
    )

    let attempted = 0
    let sent = 0
    for (const d of due) {
      const outcome = await this.attemptBlackMaskDelivery(d.id, cfg, opts.lookupCustomer)
      if (outcome === "not_claimed") continue
      attempted++
      if (outcome === "succeeded") sent++
    }
    return { attempted, sent }
  }

  /**
   * Claim a Black Mask row for one attempt: a single conditional UPDATE that
   * only matches a pending/failed row that is due, and in the same statement
   * pushes `next_attempt_at` out by the lease and counts the attempt. Two
   * drains racing for one row: Postgres serialises the UPDATEs on the row
   * lock, the second re-evaluates the predicate against the leased row and
   * matches nothing. A claimer that dies mid-send leaves the row re-claimable
   * when the lease expires, with the attempt already counted.
   *
   * Returns the attempt number, or null when the row was not claimable.
   * Without a reachable pg connection nothing is claimed and nothing is sent:
   * an unclaimed send is exactly the double-send this exists to prevent.
   */
  private async claimBlackMaskDelivery(deliveryId: string): Promise<number | null> {
    const pg = this.resolvePgConnection()
    if (!pg) return null
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + BLACK_MASK_CLAIM_LEASE_MS)
    const result = await pg.raw(
      `UPDATE marketplace_webhook_delivery
          SET attempt = attempt + 1,
              next_attempt_at = ?,
              updated_at = NOW()
        WHERE id = ?
          AND subscription_id = ?
          AND deleted_at IS NULL
          AND status IN ('pending', 'failed')
          AND next_attempt_at <= ?
      RETURNING id, attempt`,
      [leaseUntil, deliveryId, BLACK_MASK_SUBSCRIPTION_ID, now]
    )
    const row = result?.rows?.[0]
    if (!row) return null
    const attempt = Number(row.attempt)
    return Number.isFinite(attempt) && attempt > 0 ? attempt : null
  }

  /**
   * One claimed attempt: build the body (email on `placed` only, resolved
   * now), sign `"{timestamp}.{raw_body}"` fresh, POST with a 10s timeout,
   * then succeeded / failed-with-next-rung / dead. The request body is never
   * stored and never logged.
   */
  private async attemptBlackMaskDelivery(
    deliveryId: string,
    cfg: BlackMaskConfig,
    lookupCustomer: BlackMaskCustomerLookup
  ): Promise<"not_claimed" | "succeeded" | "failed" | "dead"> {
    const attempt = await this.claimBlackMaskDelivery(deliveryId)
    if (attempt === null) return "not_claimed"

    const [delivery] = await this.listWebhookDeliveries({ id: deliveryId })
    if (!delivery) return "not_claimed"
    const payload: unknown = delivery.payload
    if (!isBlackMaskStoredPayload(payload)) {
      await this.updateWebhookDeliveries({
        id: deliveryId,
        attempt,
        status: WebhookDeliveryStatus.DEAD,
        response_code: null,
        response_body: "malformed_payload",
        next_attempt_at: null,
      })
      return "dead"
    }

    let email: string | null = null
    if (payload.event === "placed" && payload.customer_id) {
      try {
        email = deliverableEmail(await lookupCustomer(payload.customer_id))
      } catch {
        // Sending a `placed` without the invite address because a read
        // hiccuped would provision a vault nobody is told about. Retry.
        return this.finishBlackMaskAttempt(deliveryId, attempt, null, "customer_lookup_failed", false)
      }
    }

    const rawBody = buildBlackMaskWireBody(payload, email)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "X-FBM-Timestamp": timestamp,
      "X-FBM-Signature": signBlackMaskBody(cfg.secret, timestamp, rawBody),
      "X-FBM-Key-Id": cfg.keyId,
      "X-FBM-Event-Id": payload.event_id,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BLACK_MASK_FETCH_TIMEOUT_MS)
    let responseCode: number | null = null
    let responseBody: string | null = null
    let ok = false
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
      })
      responseCode = res.status
      responseBody = (await res.text()).slice(0, 500)
      ok = res.ok
    } catch (err) {
      responseBody = controller.signal.aborted
        ? "timeout"
        : err instanceof Error
          ? err.message.slice(0, 500)
          : "fetch_error"
    } finally {
      clearTimeout(timer)
    }

    return this.finishBlackMaskAttempt(deliveryId, attempt, responseCode, responseBody, ok)
  }

  private async finishBlackMaskAttempt(
    deliveryId: string,
    attempt: number,
    responseCode: number | null,
    responseBody: string | null,
    ok: boolean
  ): Promise<"succeeded" | "failed" | "dead"> {
    if (ok) {
      await this.updateWebhookDeliveries({
        id: deliveryId,
        attempt,
        status: WebhookDeliveryStatus.SUCCEEDED,
        response_code: responseCode,
        response_body: responseBody,
        delivered_at: new Date(),
        next_attempt_at: null,
      })
      return "succeeded"
    }
    const delay = blackMaskRetryDelayMinutes(attempt)
    if (delay === null) {
      await this.updateWebhookDeliveries({
        id: deliveryId,
        attempt,
        status: WebhookDeliveryStatus.DEAD,
        response_code: responseCode,
        response_body: responseBody,
        next_attempt_at: null,
      })
      return "dead"
    }
    await this.updateWebhookDeliveries({
      id: deliveryId,
      attempt,
      status: WebhookDeliveryStatus.FAILED,
      response_code: responseCode,
      response_body: responseBody,
      next_attempt_at: new Date(Date.now() + delay * 60_000),
    })
    return "failed"
  }

  /**
   * The module's knex, the barter / hawala-ledger way: a registered
   * PG_CONNECTION on the module container or cradle first, then the MikroORM
   * manager's knex. Undefined when neither is reachable.
   */
  private resolvePgConnection(): PgRaw | undefined {
    const self = this as unknown as {
      __container__?: Record<string, unknown> & { resolve?: (key: string) => unknown }
      baseRepository_?: { getActiveManager?: () => KnexHolder | undefined }
    }
    const container = self.__container__
    try {
      const pg = (container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]) as PgRaw | undefined
      if (pg && typeof pg.raw === "function") return pg
    } catch {
      // the awilix cradle throws on an unregistered key; fall through
    }
    try {
      const em = self.baseRepository_?.getActiveManager?.() ?? (container?.manager as KnexHolder | undefined)
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex && typeof knex.raw === "function") return knex
    } catch {
      // no reachable connection
    }
    return undefined
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

    if (delivery.subscription_id === BLACK_MASK_SUBSCRIPTION_ID) {
      // Black Mask rows are sent only by drainBlackMaskDeliveries(), which
      // claims the row first and carries the send-time customer lookup the
      // `placed` invite needs. Treating one as a per-seller delivery would
      // DEAD it on the missing subscription row.
      return false
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
        // Black Mask rows have their own drain (claim, timeout, longer
        // ladder); leaving them in this list would let a backlog of them
        // crowd the other channels out of the `take` window.
        subscription_id: { $ne: BLACK_MASK_SUBSCRIPTION_ID },
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
