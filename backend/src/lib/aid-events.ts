import { createLogger } from "../shared/logger"
const log = createLogger("lib/aid-events")
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import type { MedusaContainer } from "@medusajs/framework/types"

/** The single internal event that drives the §3.8 Blackout aid mirror. */
export const AID_REQUEST_CHANGED = "mutual_aid.request_changed"

/**
 * Announce that a request's public state changed.
 *
 * Carries a request id and nothing else. The subscriber re-reads the row and
 * projects it, which is what keeps the requester's id and coordinates off the
 * seam structurally rather than by everyone remembering not to put them on it.
 *
 * Always best-effort. Every caller has already committed the state change this
 * describes, and none of them should fail because a mirror could not be told.
 */
export async function emitAidRequestChanged(
  container: MedusaContainer,
  requestId: string
): Promise<void> {
  try {
    const eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({ name: AID_REQUEST_CHANGED, data: { request_id: requestId } })
  } catch (err) {
    log.warn(
      `[aid-events] could not announce ${requestId}:`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Route-side convenience: same thing, resolving the container off the request. */
export async function announceAidRequestChanged(
  req: { scope: MedusaContainer },
  requestId: string
): Promise<void> {
  return emitAidRequestChanged(req.scope, requestId)
}
