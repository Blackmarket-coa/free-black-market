import { createLogger } from "../shared/logger"
const log = createLogger("jobs/donation-batch-disbursement")
import { MedusaContainer } from "@medusajs/framework/types"
import { DONATION_MODULE } from "../modules/donation"
import DonationModuleService from "../modules/donation/service"
import { featureFlagState } from "../shared/feature-flags"

export type DonationBatchDisbursementOutcome =
  | { skipped: true; reason: string }
  | { skipped: false; count: number }

/**
 * Legacy tier-2 batch disbursement: queues `donation_disbursement` rows from
 * the accrued balances when `settlement_mode` is `ledger_batch`. Nothing here
 * sends money; it is the bookkeeping half of the custody-shaped path that
 * `subscribers/donation-order-accrued.ts` feeds.
 *
 * While FF_NONPROFIT_PARITY_V1 is on the job is a no-op: donations are direct
 * charges on the org's own account (docs/POSTURE_A_COMPLIANCE.md rule 10) and
 * there is no FBM-held balance to disburse. The flag is checked before the
 * container is touched. With the flag off the job runs exactly as before.
 */
export default async function donationBatchDisbursementJob(
  container: MedusaContainer
): Promise<DonationBatchDisbursementOutcome> {
  if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    const outcome: DonationBatchDisbursementOutcome = {
      skipped: true,
      reason: "FF_NONPROFIT_PARITY_V1 is on; donations are direct charges, there is no FBM-held balance to disburse",
    }
    log.info("[DonationBatch] skipped:", outcome.reason)
    return outcome
  }

  const service = container.resolve<DonationModuleService>(DONATION_MODULE)
  const now = new Date()
  const start = new Date(now.getTime() - 7 * 86400000)

  const result = (await service.queueBatchDisbursement(start, now)) as DonationBatchDisbursementOutcome
  if (result.skipped) {
    log.info("[DonationBatch] skipped:", result.reason)
  } else {
    log.info("[DonationBatch] queued disbursements:", result.count)
  }
  return result
}

export const config = {
  name: "donation-batch-disbursement",
  schedule: "0 3 * * 1",
}
