import { createLogger } from "../shared/logger"
const log = createLogger("jobs/daily-payouts")
import { MedusaContainer } from "@medusajs/framework/types"
import mercurDailyPayouts from "@mercurjs/b2c-core/jobs/daily-payouts"
import { featureFlagState } from "../shared/feature-flags"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { ledgerRailHasSent, runLedgerConnectPayouts } from "../lib/ledger-connect-payouts"

/**
 * Replaces @mercurjs/b2c-core's `daily-payouts` job (SD-41). Medusa registers
 * a job as the workflow `job-<config.name>`, the project's jobs load after
 * the plugins' (`getResolvedPlugins` appends the project last), and both
 * workflow engines replace a schedule registered under the same id — so
 * this file, with Mercur's name, is the job that runs, and Mercur's never
 * does. `integration-tests/http/ledger-connect-payouts.spec.ts` runs
 * `job-daily-payouts` through the workflow engine and checks it is this one.
 *
 *   - FF_LEDGER_CONNECT_PAYOUTS_V1 off: Mercur's own handler, unchanged —
 *     unless the ledger rail has ever sent a payout, in which case it would
 *     pay orders the ledger already paid, so nothing runs and an error says
 *     why (a rollback after cut-over needs a person).
 *   - On: vendors are paid from the ledger (`lib/ledger-connect-payouts.ts`).
 *
 * Errors are logged, never thrown, so the schedule keeps running.
 */
export default async function dailyPayoutsJob(container: MedusaContainer): Promise<void> {
  try {
    if (!featureFlagState.isEnabled("LEDGER_CONNECT_PAYOUTS_V1")) {
      const hawala = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
      if (await ledgerRailHasSent(hawala)) {
        log.error(
          "[daily-payouts] FF_LEDGER_CONNECT_PAYOUTS_V1 is off, but the ledger has already sent payouts: " +
            "Mercur's job would pay those orders a second time, so no payout ran — needs a person"
        )
        return
      }
      await mercurDailyPayouts(container)
      return
    }
    const summary = await runLedgerConnectPayouts(container)
    const line =
      `[daily-payouts] ledger: ${summary.sellers} payout accounts, ${summary.requested.length} requested, ` +
      `${summary.sent.length} sent, ${summary.failed.length} refused, ${summary.waiting.length} waiting, ` +
      `${summary.held.length} held, ${summary.booked_mercur_paid} Mercur-paid orders booked`
    const attention =
      summary.failed.length + summary.stuck_in_transit.length + summary.cutover_blocked.length + summary.refused_accounts.length
    if (attention > 0) log.warn(`${line}; ${attention} need a person (see above)`)
    else log.info(line)
  } catch (error) {
    log.error("[daily-payouts] run failed:", error)
  }
}

// The same name and schedule as Mercur's job: this is what replaces it.
export const config = {
  name: "daily-payouts",
  schedule: "0 0 * * *",
}
