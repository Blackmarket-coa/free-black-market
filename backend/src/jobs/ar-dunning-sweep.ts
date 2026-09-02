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
    // No event bus configured: the sweep still advances the ladder so an
    // invoice is not chased repeatedly once one is wired up.
    eventBus = null
  }

  const result = await sweepDunning(ar, async (payload) => {
    if (!eventBus) return
    await eventBus.emit({ name: "ar.invoice.overdue", data: payload })
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
