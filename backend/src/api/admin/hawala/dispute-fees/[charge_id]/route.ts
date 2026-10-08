import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readDisputeFee } from "../../../../../lib/card-dispute-fee-assignment"
import { cardLedgerDisabled } from "../../card-refunds/card-refund-shared"

/**
 * GET /admin/hawala/dispute-fees/:charge_id (SD-44 (a))
 *
 * One charge's dispute fee: what Stripe charged, what each order on its cart
 * already owes of it, what an admin left with BMC, and what is unassigned.
 * `reason` is null when the automatic rule decides it (nothing to assign).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  const view = await readDisputeFee(req.scope, req.params.charge_id)
  if (!view) {
    return res.status(404).json({ type: "not_found", message: `No dispute fee is recorded on charge ${req.params.charge_id}` })
  }
  return res.status(200).json({ dispute_fee: view })
}
