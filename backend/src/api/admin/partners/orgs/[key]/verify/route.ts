import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { IRS_EXEMPT_ORG_MODULE } from "../../../../../../modules/irs-exempt-org/module-key"
import { normalizeEin } from "../../../../../../modules/irs-exempt-org/ein"
import type IrsExemptOrgModuleService from "../../../../../../modules/irs-exempt-org/service"
import { PARTNER_DIRECTORY_MODULE } from "../../../../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../../../../modules/partner-directory/service"
import type { ApplyIrsLookupResult, PartnerOrgRecord } from "../../../../../../modules/partner-directory/service"
import { featureDisabled, rejectBody, sendServiceError } from "../../schema"

/**
 * POST /admin/partners/orgs/:key/verify
 *
 * Ask the IRS files what they say about this org's EIN and record the answer.
 * This is the only operator-reachable path that changes verification, and it
 * still cannot *choose* the answer: the body carries at most an `ein`
 * override, never a status. The status, the file date and the source are
 * written by `applyIrsLookup` in the partner-directory service from the
 * lookup result — the same code the weekly ingest sweep uses — so an admin
 * click and the scheduled run cannot disagree (legal checkpoint L11).
 *
 * Gated by FF_NONPROFIT_PARITY_V1 in `middlewares.ts` (the
 * `/admin/partners/orgs*` matcher covers this path) and again here.
 *
 * Responses:
 * - 200 `{ applied: true, ... }` — status written; `auto_unpublished: true`
 *   when a revoked / not_found result forced a published IRS org dark.
 * - 200 `{ applied: false, reason }` — the IRS has no opinion to record
 *   (coop / unincorporated, or no IRS file ingested yet); the row is unchanged.
 * - 409 `ein_required` — the org has no EIN and none was supplied.
 * - 400 — a verification field in the body (named), or a malformed EIN.
 */
const VerifyPartnerOrgBody = z
  .object({
    /** Optional: store this EIN on the org before looking it up. */
    ein: z
      .string()
      .trim()
      .regex(/^\d{2}-?\d{7}$/, "nine digits, with or without the hyphen")
      .optional(),
  })
  .strict()

type VerifyResponse = {
  key: string
  applied: boolean
  reason?: Extract<ApplyIrsLookupResult, { applied: false }>["reason"]
  verification_status: PartnerOrgRecord["verification_status"]
  verification_source: string | null
  verified_as_of: Date | null
  verification_checked_at: Date | null
  published: boolean
  auto_unpublished: boolean
}

function toResponse(result: ApplyIrsLookupResult): VerifyResponse {
  const { org } = result
  return {
    key: org.key,
    applied: result.applied,
    ...(result.applied ? {} : { reason: result.reason }),
    verification_status: org.verification_status,
    verification_source: org.verification_source ?? null,
    verified_as_of: org.verified_as_of ?? null,
    verification_checked_at: org.verification_checked_at ?? null,
    published: org.published,
    auto_unpublished: result.applied ? result.auto_unpublished : false,
  }
}

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (featureDisabled(res)) return

  const key = (req.params as { key?: string } | undefined)?.key
  if (typeof key !== "string" || key.length === 0) {
    return res.status(400).json({ type: "invalid_request", message: "Missing partner org key" })
  }

  const parsed = VerifyPartnerOrgBody.safeParse(req.body ?? {})
  if (!parsed.success) return rejectBody(res, req.body, parsed.error)

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)

  try {
    let org = await directory.getOrgByKey(key)
    if (!org) return res.status(404).json({ type: "not_found", message: `Partner org ${key} not found` })

    if (parsed.data.ein !== undefined) {
      const ein = normalizeEin(parsed.data.ein)
      if (ein === null) {
        return res.status(400).json({
          type: "invalid_request",
          message: "ein must be an EIN: nine digits, with or without the hyphen (12-3456789)",
        })
      }
      org = await directory.updateOrg(key, { ein })
    }

    if (!org.ein) {
      return res.status(409).json({
        type: "ein_required",
        message: `Partner org ${key} has no EIN on record; supply one in the body (ein) or set it via PATCH before verifying.`,
      })
    }

    const irs = req.scope.resolve<IrsExemptOrgModuleService>(IRS_EXEMPT_ORG_MODULE)
    const lookup = await irs.lookupEin(org.ein)
    const result = await directory.applyIrsLookup(key, lookup, new Date())
    return res.status(200).json(toResponse(result))
  } catch (error) {
    return sendServiceError(res, error)
  }
}
