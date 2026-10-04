import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"
import {
  adminActorId,
  ApproveOrgAdvanceBody,
  orgAdvanceFeatureDisabled,
  rejectOrgAdvanceBody,
  sendOrgAdvanceError,
  serializeOrgAdvance,
} from "../../org-advance-shared"

/**
 * POST /admin/hawala/advances/orgs/:id/approve — the explicit operator
 * approval that makes an org advance ACTIVE.
 *
 * `approved_by` is the authenticated admin actor (401 without one — an
 * approval must name its approver); `disbursement_reference` is the
 * operator's reference for the money that moved from BMC's own balance to the
 * org's connected account, outside the ledger. The service is idempotent on
 * it: a replay with the same reference is 200 `{ approved: false, reason:
 * "already_approved" }`, a different reference 409 `reference_mismatch`. No
 * ledger entry is written; nothing on BMC's books moves
 * (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a).
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (orgAdvanceFeatureDisabled(res)) return

  const parsed = ApproveOrgAdvanceBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectOrgAdvanceBody(res, parsed.error)
  const approvedBy = adminActorId(req)
  if (!approvedBy) {
    return res.status(401).json({ type: "unauthorized", message: "An approval must name its approver." })
  }
  const { id } = req.params

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const result = await hawala.approveOrgAdvance(id, {
      approved_by: approvedBy,
      disbursement_reference: parsed.data.disbursement_reference,
    })
    return res.status(200).json({ ...result, advance: serializeOrgAdvance(result.advance) })
  } catch (error) {
    return sendOrgAdvanceError(res, error)
  }
}
