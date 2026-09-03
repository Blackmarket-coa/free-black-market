import type { MedusaRequest } from "@medusajs/framework/http"
import { PRODUCTION_LEDGER_MODULE } from "../../../modules/production-ledger"
import type ProductionLedgerModuleService from "../../../modules/production-ledger/service"

/**
 * Resolve a production batch the seller actually owns, plus its realized yield.
 *
 * Costing never resolves the production ledger from inside the module (the two
 * stay independently adoptable), so the composition happens here at the route
 * layer — which is also the only place that can enforce seller ownership of the
 * batch before costs are attached to it.
 *
 * Returns null when the batch does not exist or belongs to another seller;
 * callers surface both as 404 so the endpoint never confirms the existence of
 * another vendor's batch.
 */
export async function resolveOwnedBatch(
  req: MedusaRequest,
  sellerId: string,
  productionBatchId: string
): Promise<{ id: string; yield_qty: number | null } | null> {
  const ledger = req.scope.resolve<ProductionLedgerModuleService>(
    PRODUCTION_LEDGER_MODULE
  )

  try {
    const batch = await ledger.retrieveProductionBatch(productionBatchId)
    if (!batch || batch.seller_id !== sellerId) return null
    return {
      id: batch.id,
      yield_qty: batch.yield_qty === null || batch.yield_qty === undefined
        ? null
        : Number(batch.yield_qty),
    }
  } catch {
    // retrieve throws on a missing id; an unknown batch is a 404, not a 500.
    return null
  }
}
