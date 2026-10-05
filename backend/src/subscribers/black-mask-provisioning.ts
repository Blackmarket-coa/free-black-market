import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/black-mask-provisioning")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import {
  BLACK_MASK_MEDUSA_EVENTS,
  enqueueBlackMaskProvisioning,
} from "../lib/black-mask-provisioning"

/**
 * Black Mask provisioning (F3) dispatcher: one subscriber for every event the
 * channel announces. The gating (FF_BLACK_MASK_PROVISIONING_V1, complete
 * config, vault subject) and the payload live in
 * lib/black-mask-provisioning.ts. `subscription.grace_started` and
 * `subscription.read_only` are emitted by the grace slice; subscribing to an
 * event nobody emits is harmless.
 *
 * Errors are logged and swallowed so a provisioning hiccup never fails the
 * order or subscription flow that triggered it.
 */
export default async function blackMaskProvisioning({
  event,
  container,
}: SubscriberArgs<Record<string, unknown>>) {
  try {
    await enqueueBlackMaskProvisioning(container, event.name, event.data)
  } catch (err) {
    log.error(
      `[black-mask-provisioning] enqueue failed for ${event.name}:`,
      err instanceof Error ? err.message : err
    )
  }
}

export const config: SubscriberConfig = {
  event: [...BLACK_MASK_MEDUSA_EVENTS],
}
