import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { projectPoolCarrier } from "../../../../../../modules/hawala-ledger/carrier"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../../modules/partner-directory"
import { buildCarrierSnapshot, partnerOrgCarrierRefusal } from "../../../../../../modules/partner-directory/carrier"
import type PartnerDirectoryModuleService from "../../../../../../modules/partner-directory/service"
import { forbidden } from "../../../../../../shared/community-read-access"
import { createLogger } from "../../../../../../shared/logger"
import { AssignCarrierBody, carrierFeatureDisabled, rejectCarrierBody, sendCarrierError } from "../../carrier-shared"

const log = createLogger("api/admin/hawala/pools/[id]/carrier")

/**
 * POST /admin/hawala/pools/:id/carrier — assign a verified nonprofit carrier.
 *
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; legal checkpoints L26 (gates
 * go-live; surfaced, not resolved), L11 (the snapshot is dated by the IRS
 * file), L3. Gated by FF_INVESTMENT_POOLS_V1 (the `/admin/hawala/pools*`
 * matcher) AND FF_NONPROFIT_PARITY_V1 (its own matcher in middlewares.ts,
 * repeated here); neither flag alone opens it.
 *
 * Order of operations, which is the posture:
 *
 *   1. Body: `{ carrier_org_key }` only. No snapshot, status or account can
 *      arrive from the body.
 *   2. The org is read from the partner directory and `partnerOrgCarrierRefusal`
 *      runs: published, connected account present, IRS-affirmed (or coop /
 *      unincorporated). ANY refusal — including an unknown key — is
 *      `forbidden()`: 403, one body. Org keys are enumerable from
 *      `/store/partners`; a 404/403 split would say which rows exist. The
 *      reason is logged server-side only.
 *   3. The snapshot is frozen from the org (never the account id) and handed
 *      to `assignPoolCarrier`, which re-validates its shape and refuses a pool
 *      that holds any funds on BMC's ledger (409 `pool_has_ledger_funds`).
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (carrierFeatureDisabled(res)) return

  const parsed = AssignCarrierBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectCarrierBody(res, parsed.error)
  const { id } = req.params
  const { carrier_org_key } = parsed.data

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const org = await directory.getOrgByKey(carrier_org_key)
  const refusal = partnerOrgCarrierRefusal(org)
  if (refusal !== null || org === null) {
    log.warn(`[admin/hawala/pools/${id}/carrier] refused carrier ${carrier_org_key}: ${refusal}`)
    return forbidden(res)
  }

  const snapshot = buildCarrierSnapshot(org, new Date())
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const pool = await hawala.assignPoolCarrier(id, snapshot)
    return res.status(200).json({ pool, carrier: projectPoolCarrier(pool) })
  } catch (error) {
    return sendCarrierError(res, error)
  }
}
