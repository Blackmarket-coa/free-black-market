import { createLogger } from "../shared/logger"
const log = createLogger("jobs/hawala-monitor-sweep")
import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"

/**
 * Scheduled backstop for balance monitors.
 *
 * Monitors are primarily evaluated fire-and-forget at the end of every
 * `createTransfer` (so a settlement-account drain alerts within one
 * transfer). This sweep catches everything that path can miss: balances
 * moved by deposits/refund compensations outside a monitored pair, a
 * process crash between the transfer and its evaluation, and monitors
 * created after the condition was already true.
 *
 * Evaluation is edge-triggered (see
 * `modules/hawala-ledger/monitor-evaluator.ts`), so a quiet sweep over a
 * standing breach re-alerts nothing.
 */
export default async function hawalaMonitorSweepJob(
  container: MedusaContainer
): Promise<void> {
  const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)

  let monitors: any[]
  try {
    monitors = await hawala.listBalanceMonitors({ is_active: true })
  } catch (error) {
    log.error("[hawala-monitor-sweep] Failed to list monitors:", error)
    return
  }

  const accountIds = [...new Set(monitors.map((m) => m.account_id))]
  if (accountIds.length === 0) {
    log.info("[hawala-monitor-sweep] No active monitors")
    return
  }

  try {
    const summary = await hawala.evaluateMonitorsForAccounts(accountIds)
    log.info(
      `[hawala-monitor-sweep] evaluated=${summary.evaluated} breaches=${summary.breaches} cleared=${summary.cleared}`
    )
  } catch (error) {
    log.error("[hawala-monitor-sweep] Sweep failed:", error)
  }
}

export const config = {
  name: "hawala-monitor-sweep",
  // Every 15 minutes — the worst-case alert latency for a balance moved
  // outside the createTransfer fast path.
  schedule: "*/15 * * * *",
}
