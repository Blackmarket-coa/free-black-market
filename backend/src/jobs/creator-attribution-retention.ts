import { createLogger } from "../shared/logger"
const log = createLogger("jobs/creator-attribution-retention")
import { MedusaContainer } from "@medusajs/framework/types"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"

/**
 * Daily retention sweep over `attribution_click_event` (LEG-8).
 *
 * Two passes, oldest rows first, each in id batches of at most `BATCH_SIZE`
 * per statement so a large table is never locked in one go:
 *
 *   1. Anonymise: null `ip_hash`, `user_agent_hash` and `referrer` on click
 *      events older than CREATOR_ATTRIBUTION_IDENTIFIER_RETENTION_DAYS
 *      (default 30). The row survives, so last-click attribution and the
 *      fraud sweep's `click_event_id` lookups keep working.
 *   2. Delete click events older than CREATOR_ATTRIBUTION_CLICK_RETENTION_DAYS
 *      (default 365). Safe because nothing aggregates this table across all
 *      time: reporting reads `order_attribution` and `analytics_event`,
 *      `affiliate_link.click_count` is a counter incremented at click time,
 *      `order_attribution.click_event_id` is a plain text column with no
 *      foreign key, and the fraud sweep only inspects the last minute and
 *      tolerates a missing click row.
 *
 * The run stops after `MAX_BATCHES_PER_RUN` batches across both passes and
 * picks up where it left off on the next run. Neither pass touches
 * order_attribution, affiliate_link, promo_code_binding or analytics_event.
 */
export const DEFAULT_IDENTIFIER_RETENTION_DAYS = 30
export const DEFAULT_CLICK_RETENTION_DAYS = 365
export const BATCH_SIZE = 500
export const MAX_BATCHES_PER_RUN = 200

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = (raw ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return fallback
  const n = parseInt(trimmed, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export type RetentionConfig = {
  identifierRetentionDays: number
  clickRetentionDays: number
}

export function readRetentionConfig(
  env: NodeJS.ProcessEnv = process.env
): RetentionConfig {
  return {
    identifierRetentionDays: parsePositiveInt(
      env.CREATOR_ATTRIBUTION_IDENTIFIER_RETENTION_DAYS,
      DEFAULT_IDENTIFIER_RETENTION_DAYS
    ),
    clickRetentionDays: parsePositiveInt(
      env.CREATOR_ATTRIBUTION_CLICK_RETENTION_DAYS,
      DEFAULT_CLICK_RETENTION_DAYS
    ),
  }
}

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export type RetentionService = Pick<
  CreatorAttributionService,
  | "listClickEventIdsWithIdentifiersBefore"
  | "anonymizeClickEventIdentifiers"
  | "listClickEventIdsBefore"
  | "deleteClickEventsByIds"
>

export type RetentionResult = {
  anonymized: number
  deleted: number
  batches: number
  failures: number
  /** True when the batch budget ran out with work still remaining. */
  truncated: boolean
}

type PassState = { batches: number; failures: number; truncated: boolean }

async function drainPass(
  label: string,
  state: PassState,
  limits: { batchSize: number; maxBatches: number },
  fetchIds: (limit: number) => Promise<string[]>,
  apply: (ids: string[]) => Promise<number>
): Promise<number> {
  let processed = 0
  while (true) {
    if (state.batches >= limits.maxBatches) {
      state.truncated = true
      return processed
    }
    let ids: string[]
    try {
      ids = await fetchIds(limits.batchSize)
    } catch (err) {
      log.error(`[creator-attribution-retention] ${label} select failed`, err)
      state.failures++
      return processed
    }
    if (ids.length === 0) return processed
    state.batches++
    try {
      processed += await apply(ids)
    } catch (err) {
      log.error(`[creator-attribution-retention] ${label} batch failed`, err)
      state.failures++
      return processed
    }
    if (ids.length < limits.batchSize) return processed
  }
}

export async function runCreatorAttributionRetention(
  service: RetentionService,
  opts: RetentionConfig & {
    now?: Date
    batchSize?: number
    maxBatches?: number
  }
): Promise<RetentionResult> {
  const now = opts.now ?? new Date()
  const limits = {
    batchSize: opts.batchSize ?? BATCH_SIZE,
    maxBatches: opts.maxBatches ?? MAX_BATCHES_PER_RUN,
  }
  const state: PassState = { batches: 0, failures: 0, truncated: false }

  const anonymized = await drainPass(
    "anonymize",
    state,
    limits,
    (limit) =>
      service.listClickEventIdsWithIdentifiersBefore(
        retentionCutoff(now, opts.identifierRetentionDays),
        limit
      ),
    (ids) => service.anonymizeClickEventIdentifiers(ids)
  )

  const deleted = await drainPass(
    "delete",
    state,
    limits,
    (limit) =>
      service.listClickEventIdsBefore(
        retentionCutoff(now, opts.clickRetentionDays),
        limit
      ),
    (ids) => service.deleteClickEventsByIds(ids)
  )

  return {
    anonymized,
    deleted,
    batches: state.batches,
    failures: state.failures,
    truncated: state.truncated,
  }
}

export default async function creatorAttributionRetentionJob(
  container: MedusaContainer
): Promise<void> {
  const service = container.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const cfg = readRetentionConfig()

  const result = await runCreatorAttributionRetention(service, cfg)

  if (result.batches > 0 || result.failures > 0) {
    log.info(
      `[creator-attribution-retention] anonymized=${result.anonymized} ` +
        `deleted=${result.deleted} batches=${result.batches} failures=${result.failures}`
    )
  }
  if (result.truncated) {
    log.info(
      `[creator-attribution-retention] batch budget of ${MAX_BATCHES_PER_RUN} reached; remaining rows will be processed next run`
    )
  }
}

export const config = {
  name: "creator-attribution-retention",
  schedule: "30 4 * * *", // daily 04:30, off-peak and clear of the 01:30/03:00 sweeps
}
