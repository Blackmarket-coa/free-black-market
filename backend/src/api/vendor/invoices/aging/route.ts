import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../../modules/accounts-receivable"
import type AccountsReceivableService from "../../../../modules/accounts-receivable/service"

const log = createLogger("api/vendor/invoices/aging")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * GET /vendor/invoices/aging — standard AR aging for this vendor.
 *
 * The question net terms create and a JSON blob could never answer: of what
 * is owed to me, how much is late and by how long. Buckets hold outstanding
 * cents rather than invoice totals, so a half-paid invoice ages only for the
 * half still owed.
 *
 * Not plan-gated, on the same reasoning as `/vendor/revenue/channels` and
 * `/vendor/billing`: it reports on the vendor's own money, and gating it
 * would hide a collections problem from the vendors most exposed to one.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  try {
    const now = new Date()
    const aging = await ar.agingFor(sellerId, now)
    return res.json({ ...aging, as_of: now })
  } catch (err) {
    log.error("[GET /vendor/invoices/aging] failed", err)
    return res.status(500).json({ message: "Failed to compute aging" })
  }
}
