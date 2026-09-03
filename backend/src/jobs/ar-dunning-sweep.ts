import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../modules/accounts-receivable"
import type AccountsReceivableService from "../modules/accounts-receivable/service"
import type { DunningStage } from "../modules/accounts-receivable/terms"

const log = createLogger("jobs/ar-dunning-sweep")

export type DunningSweepResult = {
  considered: number
  notified: number
  failed: number
}

/**
 * The sweep's core, extracted container-free so it can be unit-tested with
 * fake services — the `demand-pool-expiry` pattern.
 *
 * Each invoice is marked dunned only after its event is emitted. The ordering
 * matters and this is the safe half: a crash between the two re-sends one
 * reminder on the next run, where the reverse would silently skip a buyer who
 * was never actually chased. A duplicate reminder is an annoyance; a missed
 * one is money.
 */
export async function sweepDunning(
  ar: Pick<AccountsReceivableService, "dueForDunning" | "markDunned" | "toView">,
  emit: (payload: {
    invoice_id: string
    seller_id: string
    customer_id: string | null
    stage: DunningStage
    outstanding: number
    currency_code: string
    due_at: Date | null
  }) => Promise<void>,
  now: Date = new Date()
): Promise<DunningSweepResult> {
  const due = await ar.dueForDunning(now)
  const result: DunningSweepResult = {
    considered: due.length,
    notified: 0,
    failed: 0,
  }

  for (const { invoice, stage } of due) {
    try {
      const view = ar.toView(invoice, now)
      await emit({
        invoice_id: view.id,
        seller_id: view.seller_id,
        customer_id: view.customer_id,
        stage,
        outstanding: view.outstanding,
        currency_code: view.currency_code,
        due_at: view.due_at,
      })
      await ar.markDunned(view.id, stage)
      result.notified += 1
    } catch (err) {
      // Per-invoice, so one bad row cannot abort the batch.
      result.failed += 1
      log.error(`[ar-dunning] failed for invoice ${invoice.id}`, err)
    }
  }

  return result
}

/**
 * Daily dunning sweep.
 *
 * Emits `ar.invoice.overdue` at each ladder stage (1, 7, 14, 30, 60 days past
 * due) so notification handlers decide what a reminder looks like. This job
 * chases, it does not compose email.
 *
 * Idempotent across a same-day re-run: `dunningStageFor` only fires on the
 * exact day a stage is reached, and `last_dunning_stage` only advances, so a
 * second run the same day finds nothing to send.
 */
export default async function arDunningSweep(container: MedusaContainer) {
  const ar = container.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  let eventBus: IEventBusModuleService | null = null
  try {
    eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
  } catch {
    eventBus = null
  }

  /**
   * The ladder is only consumed when a reminder can actually reach someone.
   *
   * `ar.invoice.overdue` currently has NO subscriber anywhere in the repo, and
   * there is no notification template for it — `resend`'s provider accepts a
   * fixed list that does not include one. The original version emitted into
   * that void and marked the stage anyway, with a comment claiming this stopped
   * an invoice being "chased repeatedly once one is wired up". It did the
   * opposite: `last_dunning_stage` only ever advances, and `dunningStageFor`
   * fires only on the exact day a stage is reached, so every stage burned while
   * unwired is a reminder the buyer can never receive. A buyer would be
   * recorded as chased at days 1, 7, 14, 30 and 60 having been sent nothing,
   * and wiring a handler later would not re-send them.
   *
   * So the sweep now runs in one of two modes, and says which:
   *
   * - `FBM_AR_DUNNING_LIVE=1` — reminders are deliverable. Emit and mark.
   * - unset (default) — dry run. Report what WOULD be sent and leave
   *   `last_dunning_stage` untouched, so the ladder is intact on the day the
   *   notification rail lands.
   *
   * Delete this flag once a subscriber exists; a permanent dry run is its own
   * kind of lie.
   */
  const live = process.env.FBM_AR_DUNNING_LIVE === "1" && !!eventBus

  if (!live) {
    const pending = await ar.dueForDunning()
    if (pending.length > 0) {
      log.warn(
        `[ar-dunning] DRY RUN: ${pending.length} invoice(s) have reached a dunning ` +
          `stage and would be chased, but no reminder can be delivered ` +
          `(FBM_AR_DUNNING_LIVE is not 1, or no event bus). The ladder is NOT ` +
          `being advanced, so these stages remain sendable once a subscriber for ` +
          `ar.invoice.overdue exists.`
      )
    }
    return { considered: pending.length, notified: 0, failed: 0 }
  }

  const result = await sweepDunning(ar, async (payload) => {
    await eventBus!.emit({ name: "ar.invoice.overdue", data: payload })
  })

  if (result.considered > 0) {
    log.info(
      `[ar-dunning] considered=${result.considered} notified=${result.notified} failed=${result.failed}`
    )
  }

  return result
}

export const config = {
  name: "ar-dunning-sweep",
  // Early morning, after the day has fully turned over in every US timezone,
  // so an invoice due "today" is never chased on the day it is due.
  schedule: "0 9 * * *",
}
