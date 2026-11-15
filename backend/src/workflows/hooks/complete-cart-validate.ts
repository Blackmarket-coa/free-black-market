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
 * It is the only seam on the checkouts built on `completeCartWorkflow`; FBM's
 * main checkout, `POST /store/carts/:id/complete` (Mercur's
 * `splitAndCompleteCartWorkflow`), never calls this hook, so none of these
 * four guards runs there (SD-54, open).
 *
 * The CCR and order-cycle guards get the hook's argument uncast. Both used to
 * be called through `as any` while reading `input.cart_id`, a field Medusa
 * never passes, so neither ran at any checkout and nothing said so (SD-54;
 * `complete-cart-validate-args.ts`). Uncast, a guard whose argument type
 * shares no field with Medusa's no longer compiles.
 */
completeCartWorkflow.hooks.validate(async (args, context) => {
  await validateSlidingScaleTier(args as any, context as any)
  await validateRentalOnCompleteCart(args as any, context as any)
  await validateCcrReservation(args, context)
  await validateOrderCycleOnCompleteCart(args, context)
})
