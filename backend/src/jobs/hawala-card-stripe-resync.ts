import { createLogger } from "../shared/logger"
const log = createLogger("jobs/hawala-card-stripe-resync")
import { MedusaContainer } from "@medusajs/framework/types"
import { featureFlagState } from "../shared/feature-flags"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import {
  stripeChargeFetcher,
  stripeRecentChargeLister,
  syncCardChargeFromStripe,
  type ChargeFetcher,
  type CardStripeSyncOutcome,
  type RecentChargeLister,
} from "../lib/card-stripe-sync"

/** Refunds and disputes created at Stripe this recently are re-read every run. */
export const STRIPE_RESYNC_WINDOW_HOURS = 72
/** Per run; anything beyond is logged with its count and picked up next run. */
export const STRIPE_RESYNC_MAX_CHARGES = 500
const HOUR_MS = 60 * 60 * 1000

export type StripeResyncResult = {
  charges: number
  deferred: number
  counts: Partial<Record<CardStripeSyncOutcome["outcome"], number>>
  listed: boolean
}

/**
 * The safety net under the Stripe charge and dispute webhooks (SD-43 open
 * item (b); `FF_CARD_ORDER_LEDGER_V1`). A webhook Stripe never delivered, or
 * one that failed, would otherwise leave the ledger as it was:
 *
 *   - an open dispute whose close never arrived holds that charge's sellers
 *     with no end (operator answer 2026-10-07: an open dispute holds payouts);
 *   - a dashboard refund or a new dispute that never arrived posts nothing
 *     and holds nobody.
 *
 * So, hourly, every charge with an open dispute on record, then every charge
 * Stripe shows a refund or dispute created in the last
 * STRIPE_RESYNC_WINDOW_HOURS, is re-read through the same path the webhook
 * uses (`syncCardChargeFromStripe`): it re-reads the whole charge, ignores
 * anything not paid through FBM's own Stripe registration, and posts only
 * what the ledger does not already have. Open disputes go first, because they
 * are what holds a vendor. It only reads Stripe; it never refunds or moves
 * money there. Never throws.
 */
export async function resyncCardChargesFromStripe(
  container: MedusaContainer,
  deps: { listRecentCharges?: RecentChargeLister; fetchCharge?: ChargeFetcher; now?: Date } = {}
): Promise<StripeResyncResult> {
  const now = deps.now ?? new Date()
  const hawala = container.resolve(HAWALA_LEDGER_MODULE) as HawalaLedgerModuleService
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }

  const open = await hawala.listCardChargeStates(
    { dispute_open_cents: { $gt: 0 } },
    { order: { synced_at: "ASC" }, select: ["stripe_charge_id"] }
  )
  for (const row of open) push(row.stripe_charge_id)

  let listed = true
  try {
    const since = new Date(now.getTime() - STRIPE_RESYNC_WINDOW_HOURS * HOUR_MS)
    for (const id of await (deps.listRecentCharges ?? stripeRecentChargeLister())(since)) push(id)
  } catch (error) {
    listed = false
    log.error("[hawala-card-stripe-resync] Could not list recent Stripe refunds and disputes:", error)
  }

  const batch = ids.slice(0, STRIPE_RESYNC_MAX_CHARGES)
  const deferred = ids.length - batch.length
  if (deferred > 0) {
    log.warn(`[hawala-card-stripe-resync] ${ids.length} charges to re-read; ${deferred} left for the next run`)
  }
  const fetchCharge = deps.fetchCharge ?? stripeChargeFetcher()
  const counts: StripeResyncResult["counts"] = {}
  for (const id of batch) {
    const { outcome } = await syncCardChargeFromStripe(container, id, { fetchCharge })
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }
  return { charges: batch.length, deferred, counts, listed }
}

export default async function hawalaCardStripeResyncJob(container: MedusaContainer): Promise<void> {
  if (!featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")) return
  if (!process.env.STRIPE_API_KEY) {
    log.warn("[hawala-card-stripe-resync] STRIPE_API_KEY is not set; Stripe refunds and disputes were not re-read")
    return
  }
  try {
    const result = await resyncCardChargesFromStripe(container)
    const line = `[hawala-card-stripe-resync] ${result.charges} charges: ${JSON.stringify(result.counts)}`
    if ((result.counts.failed ?? 0) > 0 || !result.listed) log.warn(`${line} — some could not be read (see the errors above)`)
    else log.info(line)
  } catch (error) {
    log.error("[hawala-card-stripe-resync] Run failed:", error)
  }
}

export const config = {
  name: "hawala-card-stripe-resync",
  schedule: "23 * * * *",
}
