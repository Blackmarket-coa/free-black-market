import { createLogger } from "../shared/logger"
const log = createLogger("jobs/donation-batch-disbursement")
import { MedusaContainer } from "@medusajs/framework/types"
import { DONATION_MODULE } from "../modules/donation"
import DonationModuleService from "../modules/donation/service"

export default async function donationBatchDisbursementJob(container: MedusaContainer) {
  const service = container.resolve<DonationModuleService>(DONATION_MODULE)
  const now = new Date()
  const start = new Date(now.getTime() - 7 * 86400000)

  const result = await service.queueBatchDisbursement(start, now)
  if ((result as any).skipped) {
    log.info("[DonationBatch] skipped:", (result as any).reason)
  } else {
    log.info("[DonationBatch] queued disbursements:", (result as any).count)
  }
}

export const config = {
  name: "donation-batch-disbursement",
  schedule: "0 3 * * 1",
}
