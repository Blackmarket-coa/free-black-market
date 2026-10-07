import type { MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../../../shared/feature-flags"
import { RefundAttributionError } from "../../../../lib/card-refund-attribution"

/**
 * Shared pieces of the card-refund admin routes (SD-40). Holds and
 * unassigned refunds only exist once card orders reach the ledger, so both
 * routes answer 404 `feature_disabled` without FF_CARD_ORDER_LEDGER_V1 — in
 * `middlewares.ts` and again here, so a matcher typo cannot open them.
 */
export function cardLedgerDisabled(res: MedusaResponse): boolean {
  if (featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")) return false
  res.status(404).json({
    type: "feature_disabled",
    message: `Feature flag ${PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1} is disabled`,
  })
  return true
}

export const AttributeRefundBody = z
  .object({
    allocations: z
      .array(
        z
          .object({
            order_id: z.string().min(1),
            amount: z.number().positive().finite(),
          })
          .strict()
      )
      .min(1),
  })
  .strict()

const STATUS: Record<RefundAttributionError["code"], number> = {
  not_found: 404,
  not_shared: 409,
  nothing_to_assign: 409,
  invalid_allocation: 400,
  amount_mismatch: 400,
}

export function sendRefundAttributionError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (error instanceof RefundAttributionError) {
    return res.status(STATUS[error.code]).json({ type: error.code, message: error.message, ...error.details })
  }
  const message = error instanceof Error ? error.message : "Could not assign the refund"
  return res.status(500).json({ type: "unexpected_state", message })
}
