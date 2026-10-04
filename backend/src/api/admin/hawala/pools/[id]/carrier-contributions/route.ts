import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { CarrierContributionBody, carrierFeatureDisabled, rejectCarrierBody, sendCarrierError } from "../../carrier-shared"

/**
 * POST /admin/hawala/pools/:id/carrier-contributions — RECORD a contribution
 * the pool's carrier received on its own accounts.
 *
 * Not a payment: no wallet is debited, no ledger entry is written, no BMC
 * account is touched (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b). The record
 * is idempotent on `carrier_reference` — the carrier's own reference for the
 * money it received — so a replay answers 200 `{ recorded: false, reason:
 * "already_recorded" }` rather than a second row. The pool's totals are then
 * derived from its records by the service.
 *
 * The public contribution checkout for a carried pool (a donor paying the
 * carrier THROUGH FBM) is deliberately not built: that is the offering itself
 * and waits on counsel (L26 / L3).
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (carrierFeatureDisabled(res)) return

  const parsed = CarrierContributionBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectCarrierBody(res, parsed.error)
  const { id } = req.params

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const result = await hawala.recordCarrierContribution({
      pool_id: id,
      amount: parsed.data.amount,
      carrier_reference: parsed.data.carrier_reference,
      customer_id: parsed.data.customer_id ?? null,
      metadata: parsed.data.metadata ?? null,
    })
    return res.status(result.recorded ? 201 : 200).json(result)
  } catch (error) {
    return sendCarrierError(res, error)
  }
}
