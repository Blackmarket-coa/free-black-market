import type {
  IEventBusModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createLogger } from "../../shared/logger"
import { featureFlagState } from "../../shared/feature-flags"
import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import type SubscriptionModuleService from "../../modules/subscription/service"
import { SubscriptionStatus } from "../../modules/subscription/types"
import {
  cancelGraceStart,
  GRACE_PERIOD_ENV,
  isUntilCanceledProduct,
  resolveGracePeriodDays,
  type GracePeriodResolution,
  type GraceReason,
} from "../../modules/subscription/utils/grace"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import type EntitlementModuleService from "../../modules/entitlement/service"
import { EntitlementKind } from "../../modules/entitlement/models"
import { emitSubscriptionState } from "../../lib/blackout-subscription"

const log = createLogger("workflows/subscription/grace-lifecycle")

/**
 * F4 consumer-subscription lifecycle (docs/BLACK_MASK_LAUNCH_PLAN.md §5 F4):
 * a customer cancel or exhausted payment retries starts a grace period, then
 * read-only access with export. Never quick deletion.
 *
 * Everything here is reachable only with FF_CONSUMER_SUBSCRIPTIONS_V1 on —
 * callers check `consumerSubscriptionsEnabled()` first. With the flag on but
 * no grace length configured, `startGraceForSubscription` returns
 * `{ started: false }` and logs; the caller then keeps today's behaviour for
 * that transition. No length is ever invented.
 *
 * The status transitions themselves (and their allowed-from guards) live in
 * the service (`startGracePeriod`, `enterReadOnly`, `restoreFromGrace`,
 * `cancelDuringGrace`). This file adds what the service module cannot reach:
 * product metadata (the per-product grace override), entitlements, and events.
 */

export const SUBSCRIPTION_GRACE_STARTED_EVENT = "subscription.grace_started"
export const SUBSCRIPTION_READ_ONLY_EVENT = "subscription.read_only"

/**
 * The entitlement a READ_ONLY subscription keeps. Its other grants are
 * revoked (a status change on the row — nothing is deleted) and this one is
 * granted, so the provisioning side can tell "read and export only" from
 * "full access" without a second source of truth.
 */
export const READ_EXPORT_FEATURE_KEY = "features.subscription.read_export"

/**
 * Grant a subscription the single read/export entitlement (F4: "read-only
 * access with export. Never quick deletion."). The one grant both ends of a
 * subscription use, after their revoke: `enterReadOnlyForSubscription` (grace
 * over) and, with FF_CONSUMER_SUBSCRIPTIONS_V1 on, every expiry site of
 * process-subscription-renewals.
 *
 * Idempotent through `grant()`'s (source_subscription_id, feature_key,
 * seller_id) guard: a re-run or redelivery reactivates the one row (a revoke
 * just before it is a status change, never a delete) rather than adding a
 * second. Throws what the entitlement service throws; callers log it and keep
 * the status write that preceded it.
 */
export async function grantReadExportEntitlement(
  entitlements: EntitlementModuleService,
  subscription: {
    id: string
    customer_id?: string | null
    seller_id?: string | null
  }
): Promise<void> {
  await entitlements.grantFromSubscription({
    subscription_id: subscription.id,
    customer_id: subscription.customer_id ?? null,
    seller_id: subscription.seller_id ?? null,
    feature_key: READ_EXPORT_FEATURE_KEY,
    kind: EntitlementKind.ACCESS_PASS,
    expires_at: null,
  })
}

/** `metadata.paused_reason` prefix written by the dunning loop on exhaustion. */
const DUNNING_PAUSE_PREFIX = "payment_failed_after_"

/**
 * The dunning step writes `dunning_last_attempt_at` and then, in the same
 * step, `paused_at` — milliseconds apart. A pause much later than the last
 * dunning attempt is a later (customer) pause carrying a stale reason, from
 * before resume/pause cleared it (service.ts `withoutPausedReason`).
 */
const DUNNING_PAUSE_MATCH_WINDOW_MS = 10 * 60 * 1000

/** Whether a PAUSED row was paused by the dunning loop (and not since). */
export function isDunningPause(row: {
  paused_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}): boolean {
  const reason = row.metadata?.["paused_reason"]
  if (typeof reason !== "string" || !reason.startsWith(DUNNING_PAUSE_PREFIX)) {
    return false
  }
  const attemptRaw = row.metadata?.["dunning_last_attempt_at"]
  if (!row.paused_at || typeof attemptRaw !== "string") return false
  const pausedAt = new Date(row.paused_at).getTime()
  const attemptAt = new Date(attemptRaw).getTime()
  if (Number.isNaN(pausedAt) || Number.isNaN(attemptAt)) return false
  const gap = pausedAt - attemptAt
  return gap >= 0 && gap <= DUNNING_PAUSE_MATCH_WINDOW_MS
}

export function consumerSubscriptionsEnabled(): boolean {
  return featureFlagState.isEnabled("CONSUMER_SUBSCRIPTIONS_V1")
}

type LifecycleRow = {
  id: string
  status: string
  paused_at?: Date | string | null
  customer_id?: string | null
  product_id?: string | null
  seller_id?: string | null
  next_order_date?: Date | string | null
  grace_ends_at?: Date | string | null
  read_only_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}

export type GraceLifecyclePayload = {
  subscription_id: string
  customer_id: string | null
  product_id: string | null
  seller_id: string | null
  grace_ends_at?: string | null
  read_only_at?: string | null
  /**
   * When the transition happened, read from the row (never the emit time) so
   * a redelivered event carries the same value. The Black Mask provisioning
   * channel sequences on it and skips an event without it.
   */
  occurred_at?: string | null
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function payloadOf(row: LifecycleRow): GraceLifecyclePayload {
  return {
    subscription_id: row.id,
    customer_id: row.customer_id ?? null,
    product_id: row.product_id ?? null,
    seller_id: row.seller_id ?? null,
  }
}

/** Product metadata, or null when there is no product or the lookup fails. */
export async function loadProductMetadata(
  container: MedusaContainer,
  productId: string | null | undefined
): Promise<Record<string, unknown> | null> {
  if (!productId) return null
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "metadata"],
      filters: { id: productId },
    })
    const row = (data as Array<{ metadata?: Record<string, unknown> | null }>)[0]
    return row?.metadata ?? null
  } catch (error) {
    log.warn(
      `[grace] product metadata lookup failed for ${productId}: ${
        (error as Error)?.message ?? error
      }`
    )
    return null
  }
}

/** Per-product override first, then SUBSCRIPTION_GRACE_PERIOD_DAYS. */
export async function resolveGraceForSubscription(
  container: MedusaContainer,
  subscription: { product_id?: string | null }
): Promise<GracePeriodResolution> {
  const productMetadata = await loadProductMetadata(container, subscription.product_id)
  return resolveGracePeriodDays({
    product_metadata: productMetadata,
    platform_default: process.env[GRACE_PERIOD_ENV],
  })
}

/**
 * Whether this product MAY be sold until cancelled (product-side marker only).
 * A new subscription is until-cancelled only when this is true AND the
 * customer approved auto-renewal (createSubscriptionStep).
 */
export async function isUntilCanceledForProduct(
  container: MedusaContainer,
  productId: string | null | undefined
): Promise<boolean> {
  return isUntilCanceledProduct(await loadProductMetadata(container, productId))
}

async function emitLifecycleEvent(
  container: MedusaContainer,
  name: string,
  data: GraceLifecyclePayload
): Promise<void> {
  try {
    const eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({ name, data })
  } catch (error) {
    // Never let a notification failure undo a lifecycle write.
    log.error(`[grace] failed to emit ${name} for ${data.subscription_id}:`, error)
  }
}

export type StartGraceResult =
  | {
      started: true
      subscription: LifecycleRow
      grace_period_days: number
      source: "product" | "platform"
    }
  | { started: false; reason: "grace_not_configured" }

/**
 * ACTIVE/PAUSED → PAST_DUE with the grace length snapshotted on the row.
 *
 *   - `payment_failed`: grace starts now.
 *   - `customer_canceled`: grace starts at the end of the paid period
 *     (max(next_order_date, now)), so access runs through what was paid for
 *     plus grace.
 *
 * Active per-cycle entitlements are rolled forward to `grace_ends_at`; nothing
 * is revoked. Emits `subscription.grace_started`.
 *
 * Grace not configured → `{ started: false }` + a warning, and NO write.
 */
export async function startGraceForSubscription(
  container: MedusaContainer,
  subscriptionId: string,
  reason: GraceReason,
  opts: {
    now?: Date
    resolution?: GracePeriodResolution
    /** False: the caller logs one summary line instead (the hourly sweep). */
    warnIfUnconfigured?: boolean
  } = {}
): Promise<StartGraceResult> {
  const now = opts.now ?? new Date()
  const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
  const subscription = (await service.retrieveSubscription(
    subscriptionId
  )) as unknown as LifecycleRow

  const resolution =
    opts.resolution !== undefined
      ? opts.resolution
      : await resolveGraceForSubscription(container, subscription)

  if (!resolution) {
    if (opts.warnIfUnconfigured === false) {
      return { started: false, reason: "grace_not_configured" }
    }
    log.warn(
      `[grace] FF_CONSUMER_SUBSCRIPTIONS_V1 is on but no grace length is configured ` +
        `(${GRACE_PERIOD_ENV} unset and no product subscription_grace_period_days) — ` +
        `subscription ${subscriptionId} keeps the pre-F4 ${reason} behaviour`
    )
    return { started: false, reason: "grace_not_configured" }
  }

  const startsAt =
    reason === "customer_canceled"
      ? cancelGraceStart(subscription.next_order_date, now)
      : now

  const updated = (await service.startGracePeriod(subscriptionId, {
    reason,
    grace_period_days: resolution.days,
    starts_at: startsAt,
    now,
  })) as unknown as LifecycleRow

  if (updated.grace_ends_at) {
    try {
      const entitlements = container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
      await entitlements.extendBySubscriptionId(
        subscriptionId,
        new Date(updated.grace_ends_at)
      )
    } catch (error) {
      log.error(`[grace] failed to extend entitlements for ${subscriptionId}:`, error)
    }
  }

  const graceStartedAt = updated.metadata?.["grace_started_at"]
  await emitLifecycleEvent(container, SUBSCRIPTION_GRACE_STARTED_EVENT, {
    ...payloadOf(updated),
    grace_ends_at: iso(updated.grace_ends_at),
    occurred_at: typeof graceStartedAt === "string" ? graceStartedAt : now.toISOString(),
  })

  return {
    started: true,
    subscription: updated,
    grace_period_days: resolution.days,
    source: resolution.source,
  }
}

/**
 * PAST_DUE with grace over → READ_ONLY. Swaps the subscription's grants for
 * the single read/export entitlement (revocation is a status change; no row is
 * deleted), lapses the Blackout Space access the grace period kept open, and
 * emits `subscription.read_only`.
 */
export async function enterReadOnlyForSubscription(
  container: MedusaContainer,
  subscriptionId: string,
  now: Date = new Date()
): Promise<LifecycleRow> {
  const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
  const updated = (await service.enterReadOnly(subscriptionId, now)) as unknown as LifecycleRow

  try {
    const entitlements = container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
    await entitlements.revokeBySubscriptionId(subscriptionId, "subscription_read_only")
    await grantReadExportEntitlement(entitlements, { ...updated, id: subscriptionId })
  } catch (error) {
    log.error(`[grace] entitlement swap failed for read-only ${subscriptionId}:`, error)
  }

  await emitSubscriptionState(container, updated, "cancel")

  const readOnlyAt = iso(updated.read_only_at) ?? now.toISOString()
  await emitLifecycleEvent(container, SUBSCRIPTION_READ_ONLY_EVENT, {
    ...payloadOf(updated),
    read_only_at: readOnlyAt,
    occurred_at: readOnlyAt,
  })

  return updated
}

export type GraceSweepOutcome = {
  read_only: string[]
  dunning_paused_to_grace: string[]
  failed: Array<{ subscription_id: string; error: string }>
}

/**
 * The hourly F4 sweep, run by `process-subscription-renewals` after its
 * renewal pass when the flag is on:
 *
 *   1. PAUSED rows the dunning loop parked before this flag existed
 *      (`isDunningPause`: a "payment_failed_after_…" `paused_reason` whose
 *      `paused_at` matches the last dunning attempt) enter grace now. Without
 *      this they keep full access forever — nothing ever moved them out.
 *      Grace starts at the sweep, not retroactively at `paused_at`, so no
 *      customer goes read-only the instant the flag is flipped. A voluntary
 *      pause is never swept, stale reason or not. With no grace length
 *      configured these rows stay paused, and the sweep logs ONE line per run
 *      rather than one per row per hour.
 *   2. PAST_DUE rows whose grace has ended become READ_ONLY.
 *
 * One row's failure never aborts the sweep.
 */
export async function sweepGraceLifecycle(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<GraceSweepOutcome> {
  const service = container.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
  const outcome: GraceSweepOutcome = {
    read_only: [],
    dunning_paused_to_grace: [],
    failed: [],
  }

  const paused = (await service.listSubscriptions({
    status: SubscriptionStatus.PAUSED,
  })) as unknown as LifecycleRow[]
  let notConfigured = 0
  for (const row of paused) {
    if (!isDunningPause(row)) {
      continue
    }
    try {
      const result = await startGraceForSubscription(container, row.id, "payment_failed", {
        now,
        warnIfUnconfigured: false,
      })
      if (result.started) outcome.dunning_paused_to_grace.push(row.id)
      else notConfigured++
    } catch (error) {
      outcome.failed.push({
        subscription_id: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (notConfigured > 0) {
    log.warn(
      `[grace] FF_CONSUMER_SUBSCRIPTIONS_V1 is on but no grace length is configured ` +
        `(${GRACE_PERIOD_ENV} unset and no product subscription_grace_period_days) — ` +
        `${notConfigured} dunning-paused subscription(s) stay paused (pre-F4 behaviour)`
    )
  }

  const expired = (await service.listGraceExpired(now)) as unknown as LifecycleRow[]
  for (const row of expired) {
    try {
      await enterReadOnlyForSubscription(container, row.id, now)
      outcome.read_only.push(row.id)
    } catch (error) {
      outcome.failed.push({
        subscription_id: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return outcome
}
