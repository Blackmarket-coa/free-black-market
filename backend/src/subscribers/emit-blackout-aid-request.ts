import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-aid-request")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { MUTUAL_AID_MODULE } from "../modules/mutual-aid"
import type MutualAidModuleService from "../modules/mutual-aid/service"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { aidEventTypeFor, toBlackoutAidFields } from "../lib/blackout-aid"

/**
 * Mirror an ask onto Blackout's Coalition board (§3.8).
 *
 * One subscriber for the whole family rather than one per transition: the
 * request's own status decides which of the three types to send, so the routes
 * emit a single `mutual_aid.request_changed` and never have to know the wire
 * vocabulary. Adding a status to the model without deciding what it means over
 * the seam then produces no event at all, rather than a wrong one.
 *
 * The payload is built by `toBlackoutAidFields`, which takes `toPublicAid`'s
 * output and nothing else. That is load-bearing rather than tidy: Blackout's
 * `GET /v1/coalition/mutual-aid` publishes its rows verbatim, so a column that
 * reached this event would be published to the world. The row is deliberately
 * never read directly here.
 *
 * `eventId` is `<type>:<request_id>` so a retry of the same transition is the
 * same event, and the mirror's origin-keyed upsert lands it on the same row.
 */
export default async function emitBlackoutAidRequest({
  event,
  container,
}: SubscriberArgs<{ request_id?: string }>) {
  const requestId = event.data.request_id
  if (!requestId) return

  try {
    const service = container.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const [request] = await service.listMutualAidRequests({ id: requestId })
    if (!request) return

    const type = aidEventTypeFor(request.status as string | null)
    if (!type) return

    await emitBlackoutEvent(
      container,
      type,
      toBlackoutAidFields(request as unknown as Record<string, unknown>) as unknown as Record<
        string,
        unknown
      >,
      { eventId: `${type}:${requestId}` }
    )
  } catch (err) {
    // Best-effort, like every other Blackout emitter: a mirror that misses a
    // transition is worse than one that never ran, but neither is worth
    // failing the aid action that triggered it.
    log.error(`[emit-blackout-aid-request] failed for request ${requestId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "mutual_aid.request_changed",
}
