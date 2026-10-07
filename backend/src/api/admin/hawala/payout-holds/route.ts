import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { cardLedgerDisabled } from "../card-refunds/card-refund-shared"

const MAX = 200

/**
 * GET /admin/hawala/payout-holds?status=ACTIVE|RELEASED (SD-40)
 *
 * Payout holds, oldest first: ACTIVE by default (who is held, on which
 * shared collection, since when, for how much), RELEASED with who released
 * them and why. At most 200 per call; `truncated` says when there were more.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  const raw = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "ACTIVE"
  if (raw !== "ACTIVE" && raw !== "RELEASED") {
    return res.status(400).json({ type: "invalid_request", message: "status must be ACTIVE or RELEASED" })
  }
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const holds = await hawala.listPayoutHolds({ status: raw }, { order: { placed_at: "ASC" }, take: MAX + 1 })
  return res.status(200).json({ holds: holds.slice(0, MAX), truncated: holds.length > MAX })
}
