import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readCollectionRefunds } from "../../../../../lib/card-refund-attribution"
import { cardLedgerDisabled, sendRefundAttributionError } from "../card-refund-shared"

/**
 * GET /admin/hawala/card-refunds/:payment_collection_id (SD-40)
 *
 * A shared card collection's money as the ledger reads it: what was
 * captured and refunded on the collection, each order's own captured and
 * refunded amounts (its Mercur split row), the part of the refund no order
 * records (`unassigned`), and the payout holds it has placed. What an admin
 * reads before assigning the refund (`POST .../attribute`).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  try {
    const view = await readCollectionRefunds(req.scope, req.params.payment_collection_id)
    if (!view) return res.status(404).json({ type: "not_found", message: "No such payment collection" })
    return res.status(200).json({ collection: view })
  } catch (error) {
    return sendRefundAttributionError(res, error)
  }
}
