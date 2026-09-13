import { completeCartWorkflow } from "@medusajs/medusa/core-flows"

import { validateSlidingScaleTier } from "./validate-sliding-scale-tier"
import { validateRentalOnCompleteCart } from "../rental/hooks/validate-rental"
import { validateCcrReservation } from "./validate-ccr-reservation"
import { validateOrderCycleOnCompleteCart } from "./validate-order-cycle"

/**
 * Single `completeCartWorkflow.hooks.validate` handler.
 *
 * Medusa v2 allows only one handler per workflow hook, so the
 * sliding-scale-tier and rental validators (previously each
 * self-registering on this hook, which crashed app boot with
 * "Cannot define multiple hook handlers for the validate hook") are
 * composed here and run in sequence. Each throws `MedusaError` to abort
 * cart completion; ordering is independent (all are read-only guards).
 *
 * The order-cycle validator (D9-1/D9-3) joins them here rather than
 * self-registering, for the same reason, and because this is the only seam
 * where a check can run after the cart is final and before any money moves.
 */
completeCartWorkflow.hooks.validate(async (args, context) => {
  await validateSlidingScaleTier(args as any, context as any)
  await validateRentalOnCompleteCart(args as any, context as any)
  await validateCcrReservation(args as any, context as any)
  await validateOrderCycleOnCompleteCart(args as any, context as any)
})
