import type { MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { DisputeFeeAssignmentError } from "../../../../lib/card-dispute-fee-assignment"

/**
 * Shared pieces of the dispute-fee admin routes (SD-44 (a)). Like the
 * card-refund routes they exist only with FF_CARD_ORDER_LEDGER_V1, checked in
 * `middlewares.ts` and again in each handler (`cardLedgerDisabled`).
 */

export const AssignDisputeFeeBody = z
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
      .default([]),
    /** Left with BMC instead of put on a seller, major units. */
    bmc_absorbs: z.number().nonnegative().finite().optional(),
  })
  .strict()
  .refine((b) => b.allocations.length > 0 || (b.bmc_absorbs ?? 0) > 0, {
    message: "Assign the fee to at least one order, or say what BMC absorbs",
  })

const STATUS: Record<DisputeFeeAssignmentError["code"], number> = {
  not_found: 404,
  automatic: 409,
  nothing_to_assign: 409,
  invalid_allocation: 400,
  amount_mismatch: 400,
  order_not_settled: 400,
}

export function sendDisputeFeeError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (error instanceof DisputeFeeAssignmentError) {
    return res.status(STATUS[error.code]).json({ type: error.code, message: error.message, ...error.details })
  }
  const message = error instanceof Error ? error.message : "Could not assign the dispute fee"
  return res.status(500).json({ type: "unexpected_state", message })
}
