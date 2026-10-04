import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_DIRECTORY_MODULE } from "../../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../../modules/partner-directory/service"
import { CreatePartnerOrgBody, featureDisabled, orgResponse, rejectBody, sendServiceError } from "./schema"

/**
 * GET  /admin/partners/orgs — every partner org, published or not.
 * POST /admin/partners/orgs — create one.
 *
 * Operator surface for pilot-partner records (docs/BMC_SURVIVAL_PROGRAMS.md
 * Phase 1 item 1). Gated by FF_NONPROFIT_PARITY_V1 in `middlewares.ts` and
 * again here. The body cannot carry verification columns (`schema.ts`), and
 * `published: true` is refused by the service for an unverified IRS org type
 * — the route relays that as 409 `publish_refused` rather than deciding L11.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (featureDisabled(res)) return

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const orgs = await directory.listPartnerOrgs({}, { order: { created_at: "ASC" } })
  return res.status(200).json({ orgs, count: orgs.length })
}

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (featureDisabled(res)) return

  const parsed = CreatePartnerOrgBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, req.body, parsed.error)

  const { publish_unverified_ack, ...input } = parsed.data
  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)

  try {
    const org = await directory.createOrg(input, { publish_unverified_ack })
    return res.status(201).json(orgResponse(org))
  } catch (error) {
    return sendServiceError(res, error)
  }
}
