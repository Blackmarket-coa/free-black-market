import { ManualFulfillmentStatus } from "./models"

/**
 * The manual-fulfillment state machine: which status may follow which.
 *
 * One table for every writer — the admin and vendor manual-fulfillment routes
 * and the supplier status webhook — so they cannot drift apart. It is a DAG
 * (nothing leads back to an earlier status), which is what makes a replayed
 * webhook harmless: once an order has moved past a status, no message can
 * move it into that status again.
 */
export const MANUAL_FULFILLMENT_TRANSITIONS: Readonly<
  Record<ManualFulfillmentStatus, readonly ManualFulfillmentStatus[]>
> = {
  [ManualFulfillmentStatus.PENDING]: [ManualFulfillmentStatus.ACKNOWLEDGED, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.ACKNOWLEDGED]: [ManualFulfillmentStatus.IN_PROGRESS, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.IN_PROGRESS]: [ManualFulfillmentStatus.SHIPPED, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.SHIPPED]: [ManualFulfillmentStatus.DELIVERED],
  [ManualFulfillmentStatus.DELIVERED]: [],
  [ManualFulfillmentStatus.CANCELED]: [],
}

export function isAllowedManualFulfillmentTransition(
  from: ManualFulfillmentStatus,
  to: ManualFulfillmentStatus
): boolean {
  return MANUAL_FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false
}
