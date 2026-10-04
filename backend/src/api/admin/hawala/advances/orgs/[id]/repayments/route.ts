import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"
import {
  adminActorId,
  orgAdvanceFeatureDisabled,
  OrgAdvanceRepaymentBody,
  rejectOrgAdvanceBody,
  sendOrgAdvanceError,
} from "../../org-advance-shared"

/**
 * POST /admin/hawala/advances/orgs/:id/repayments — RECORD a repayment the
 * org made outside the ledger.
 *
 * Not a payment: no account is debited, no ledger entry is written
 * (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a). The record is idempotent on
 * `external_reference` — the payer's / operator's own reference for the money
 * — so a replay answers 200 `{ recorded: false, reason: "already_recorded" }`
 * rather than a second row. The advance's outstanding balance is then DERIVED
 * from its rows by the service.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (orgAdvanceFeatureDisabled(res)) return

  const parsed = OrgAdvanceRepaymentBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectOrgAdvanceBody(res, parsed.error)
  const { id } = req.params

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const result = await hawala.recordOrgAdvanceRepayment(id, {
      amount: parsed.data.amount,
      external_reference: parsed.data.external_reference,
      repaid_at: parsed.data.repaid_at ? new Date(parsed.data.repaid_at) : null,
      recorded_by: adminActorId(req),
      metadata: parsed.data.metadata ?? null,
    })
    return res.status(result.recorded ? 201 : 200).json(result)
  } catch (error) {
    return sendOrgAdvanceError(res, error)
  }
}
