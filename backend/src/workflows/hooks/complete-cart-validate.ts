import { completeCartWorkflow } from "@medusajs/medusa/core-flows"

import { validateSlidingScaleTier } from "./validate-sliding-scale-tier"
import { validateRentalOnCompleteCart } from "../rental/hooks/validate-rental"

/**
 * Single `completeCartWorkflow.hooks.validate` handler.
 *
 * Medusa v2 allows only one handler per workflow hook, so the
 * sliding-scale-tier and rental validators (previously each
 * self-registering on this hook, which crashed app boot with
 * "Cannot define multiple hook handlers for the validate hook") are
 * composed here and run in sequence. Each throws `MedusaError` to abort
 * cart completion; ordering is independent (both are read-only guards).
 */
completeCartWorkflow.hooks.validate(async (args, context) => {
  await validateSlidingScaleTier(args as any, context as any)
  await validateRentalOnCompleteCart(args as any, context as any)
})
