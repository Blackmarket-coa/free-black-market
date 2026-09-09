import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { MUTUAL_AID_MODULE } from "../modules/mutual-aid"
import type MutualAidModuleService from "../modules/mutual-aid/service"
import { emitAidRequestChanged } from "../lib/aid-events"

const log = createLogger("jobs/mutual-aid-expiry")

/**
 * Retire mutual-aid requests and offers whose stated date has passed.
 *
 * `needed_by` and `available_until` were write-only columns: both create routes
 * accepted and stored them, and nothing in the codebase ever read them back.
 * The public board filters on `status` alone, so a request dated last spring
 * still reads as OPEN — and `matchRequest` would let a helper commit to it. So
 * the board accumulated dead asks indefinitely, and the two terminal statuses
 * that describe exactly this (`EXPIRED` on both enums) had no writer at all.
 *
 * The sweep is housekeeping, not the enforcement: `matchRequest` refuses an
 * out-of-date request on its own, so nothing depends on how recently this ran.
 * What it keeps honest is the board a person actually browses.
 *
 * Daily rather than hourly. A `needed_by` is a date somebody typed, not a
 * deadline measured in minutes, and sweeping a table of hundreds of rows more
 * often buys nothing.
 *
 * The rule itself is `MutualAidModuleService.expireStaleAid`, which takes `now`
 * as an argument and touches no container — this file is only the schedule, plus
 * the announcement that closes each expired ask's copy on Blackout's board.
 */
export default async function mutualAidExpiryJob(container: MedusaContainer) {
  try {
    const service = container.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const result = await service.expireStaleAid(new Date(), (requestId) =>
      emitAidRequestChanged(container, requestId)
    )

    if (result.requests_expired > 0 || result.offers_expired > 0) {
      log.info(
        `[mutual-aid] expired ${result.requests_expired} request(s) and ` +
          `${result.offers_expired} offer(s) past their stated date`
      )
    }
  } catch (err) {
    // Housekeeping must never take down the worker. A board with a stale row
    // on it is a worse board, not a broken one, and the match guard still
    // refuses the stale row either way.
    log.warn("[mutual-aid] expiry sweep failed", err)
  }
}

export const config = {
  name: "mutual-aid-expiry",
  schedule: "0 4 * * *",
}
