import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveVendorSellerId } from "../seller-context"
import {
  memberView,
  type PatronageAllocationRow,
} from "../../../../modules/hawala-ledger/patronage-review"

/**
 * GET /vendor/hawala/patronage
 *
 * A vendor's own patronage allocations.
 *
 * Patronage returns surplus in proportion to how much a member *traded*, not
 * how much they invested — it is the co-operative answer to internal capital,
 * and the reason it does not create a security. It was computed quarterly and
 * shown to nobody: no route read a `PatronageAllocation`, so a member had no
 * way to learn a refund had been calculated for them. A surplus a member never
 * hears about has not been returned.
 *
 * Seller id comes from `resolveVendorSellerId`, not from `auth_context`
 * directly, for the reason recorded in `../seller-context.ts`: this surface
 * rewrites the actor id to `mem_*` while money accrues under `sel_*`.
 *
 * Read-only. Nothing a vendor can do here changes an allocation.
 * docs/TRANSMUTATION_STRATEGY.md §5.5.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await resolveVendorSellerId(req)
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Vendor authentication required", type: "unauthorized" })
  }

  const service = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const rows = ((await (service as any).listPatronageAllocations({
    seller_id: sellerId,
  })) ?? []) as Array<PatronageAllocationRow & { paid_at?: Date | string | null }>

  const allocations = rows
    .map(memberView)
    .sort((a, b) => b.period_key.localeCompare(a.period_key))

  res.json({
    allocations,
    count: allocations.length,
    // Only paid money is reported as returned. A queued allocation is a
    // decision, not a payment.
    lifetime_paid: rows
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + Number(r.allocation_amount ?? 0), 0),
    explanation:
      "Patronage returns a share of the cooperative's surplus in proportion to the commission you paid, not to any investment. Allocations are computed quarterly and reviewed by an operator before payment.",
  })
}
