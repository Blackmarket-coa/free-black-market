import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../../../modules/partner-directory/service"
import { PatchPartnerOrgBody, featureDisabled, orgResponse, rejectBody, sendServiceError } from "../schema"

/**
 * GET   /admin/partners/orgs/:key — one partner org.
 * PATCH /admin/partners/orgs/:key — change operator-writable fields.
 *
 * Verification columns are not writable here (see `../schema.ts`); the
 * ingest owns them. Setting `published: true` is refused by the service
 * unless the IRS files have affirmed the org, or it is a coop/unincorporated
 * org and this request carries `publish_unverified_ack: true`. A successful
 * publish returns the L18 MOU notice beside the row.
 */
function keyParam(req: MedusaRequest): string | null {
  const key = (req.params as { key?: string } | undefined)?.key
  return typeof key === "string" && key.length > 0 ? key : null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (featureDisabled(res)) return

  const key = keyParam(req)
  if (!key) return res.status(400).json({ type: "invalid_request", message: "Missing partner org key" })

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const org = await directory.getOrgByKey(key)
  if (!org) return res.status(404).json({ type: "not_found", message: `Partner org ${key} not found` })

  return res.status(200).json({ org })
}

export async function PATCH(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (featureDisabled(res)) return

  const key = keyParam(req)
  if (!key) return res.status(400).json({ type: "invalid_request", message: "Missing partner org key" })

  const parsed = PatchPartnerOrgBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, req.body, parsed.error)

  const { publish_unverified_ack, ...patch } = parsed.data
  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)

  try {
    const org = await directory.updateOrg(key, patch, { publish_unverified_ack })
    return res.status(200).json(orgResponse(org))
  } catch (error) {
    return sendServiceError(res, error)
  }
}
