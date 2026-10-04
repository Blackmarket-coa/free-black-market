import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../modules/partner-directory"
import { buildCarrierSnapshot, partnerOrgCarrierRefusal } from "../../../../../modules/partner-directory/carrier"
import type PartnerDirectoryModuleService from "../../../../../modules/partner-directory/service"
import { forbidden } from "../../../../../shared/community-read-access"
import { createLogger } from "../../../../../shared/logger"
import {
  adminActorId,
  orgAdvanceFeatureDisabled,
  rejectOrgAdvanceBody,
  RequestOrgAdvanceBody,
  sendOrgAdvanceError,
  serializeOrgAdvance,
} from "./org-advance-shared"

const log = createLogger("api/admin/hawala/advances/orgs")

/**
 * POST /admin/hawala/advances/orgs — request an advance RECORD for a verified
 * nonprofit partner_org.
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a; legal checkpoints L26 (gates
 * go-live; surfaced, not resolved), L11 (the snapshot is dated by the IRS
 * file), L3. Gated by FF_VENDOR_ADVANCES_V1 AND FF_NONPROFIT_PARITY_V1 (the
 * `/admin/hawala/advances/orgs*` matcher in middlewares.ts, repeated here);
 * neither flag alone opens it. Admin-only: an org has no login.
 *
 * Order of operations, which is the posture:
 *
 *   1. Body: the org key, the terms and the OPERATOR's eligibility statement
 *      `{ basis, approved_limit }`. No snapshot, status, vendor or account can
 *      arrive from the body.
 *   2. The org is read from the partner directory and `partnerOrgCarrierRefusal`
 *      runs (the same verified-org predicate the pool carrier uses). ANY
 *      refusal — including an unknown key — is `forbidden()`: 403, one body.
 *      Org keys are enumerable from `/store/partners`; a 404/403 split would
 *      say which rows exist. The reason is logged server-side only.
 *   3. The snapshot is frozen from the org (never the account id) and handed
 *      to `requestOrgAdvance`, which re-validates it, refuses an amount over
 *      the approved limit or a second open advance, and writes a
 *      PENDING_APPROVAL row. No ledger account, no ledger entry, no
 *      auto-approve.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (orgAdvanceFeatureDisabled(res)) return

  const parsed = RequestOrgAdvanceBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectOrgAdvanceBody(res, parsed.error)
  const body = parsed.data

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const org = await directory.getOrgByKey(body.partner_org_key)
  const refusal = partnerOrgCarrierRefusal(org)
  if (refusal !== null || org === null) {
    log.warn(`[admin/hawala/advances/orgs] refused recipient ${body.partner_org_key}: ${refusal}`)
    return forbidden(res)
  }

  const snapshot = buildCarrierSnapshot(org, new Date())
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const advance = await hawala.requestOrgAdvance({
      partner_org_key: body.partner_org_key,
      recipient_snapshot: snapshot,
      amount: body.amount,
      fee_rate: body.fee_rate,
      term_days: body.term_days,
      eligibility: body.eligibility,
      requested_by: adminActorId(req),
      metadata: body.metadata ?? null,
    })
    return res.status(201).json({ advance: serializeOrgAdvance(advance) })
  } catch (error) {
    return sendOrgAdvanceError(res, error)
  }
}
