import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listUnassignedDisputeFees } from "../../../../lib/card-dispute-fee-assignment"
import { cardLedgerDisabled } from "../card-refunds/card-refund-shared"

/**
 * GET /admin/hawala/dispute-fees (SD-44 (a))
 *
 * The queue of Stripe dispute fees the automatic rule puts on no seller: a
 * partial chargeback on a Mercur cart (which order was disputed is unknown),
 * a cart where an order has no split row, or what is left after an earlier
 * assignment. Each item lists the cart's orders and what is unassigned.
 * Assign one with POST `/admin/hawala/dispute-fees/:charge_id/assign`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  const fees = await listUnassignedDisputeFees(req.scope)
  return res.status(200).json({ dispute_fees: fees, count: fees.length })
}
