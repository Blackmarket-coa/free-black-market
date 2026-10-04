import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { CarrierDistributionBody, carrierFeatureDisabled, rejectCarrierBody, sendCarrierError } from "../../carrier-shared"

/**
 * POST /admin/hawala/pools/:id/carrier-distributions — RECORD a distribution
 * the pool's carrier paid from the funds it holds.
 *
 * A record, not a payment: BMC computes no per-investor allocation (the
 * carrier allocates on its own books) and moves nothing. `distributeDividends`
 * is refused for a carried pool; this is what replaces it. Idempotent on the
 * carrier's reference; `total_distributed` is derived from these rows.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (carrierFeatureDisabled(res)) return

  const parsed = CarrierDistributionBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectCarrierBody(res, parsed.error)
  const { id } = req.params

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const result = await hawala.recordCarrierDistribution({
      pool_id: id,
      amount: parsed.data.amount,
      carrier_reference: parsed.data.carrier_reference,
      distributed_at: parsed.data.distributed_at ? new Date(parsed.data.distributed_at) : null,
      metadata: parsed.data.metadata ?? null,
    })
    return res.status(result.recorded ? 201 : 200).json(result)
  } catch (error) {
    return sendCarrierError(res, error)
  }
}
