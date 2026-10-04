import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import {
  PARTNER_ORG_RELATIONSHIP,
  PARTNER_ORG_TYPES,
  PARTNER_ORG_VERIFICATION_FIELDS,
  PARTNER_SERVES,
  PUBLISH_MOU_NOTICE,
} from "../../../../modules/partner-directory"
import type { PartnerOrgRecord } from "../../../../modules/partner-directory/service"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"

/**
 * Shared pieces for `/admin/partners/orgs` (not a route file; Medusa's loader
 * only mounts `route.ts`).
 *
 * The body schemas are `.strict()` and built from the module's exported
 * vocabularies, so an unknown key is a 400 and the enums cannot drift from
 * the model. The four verification columns are therefore unwritable from
 * here by construction — and `verificationFieldsInBody` names them in the
 * error so an operator learns why, instead of a generic "unrecognized key".
 *
 * `states` is free text with no jurisdiction rule: the directory does not
 * hard-code a country or a state list.
 */

const keySchema = z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/, "2-64 lowercase letters, digits or underscores")

const writable = {
  name: z.string().trim().min(1).max(200),
  org_type: z.enum(PARTNER_ORG_TYPES).nullable(),
  ein: z.string().regex(/^\d{2}-?\d{7}$/, "nine digits, with or without the hyphen").nullable(),
  relationship: z.enum(PARTNER_ORG_RELATIONSHIP),
  fiscal_host_key: keySchema.nullable(),
  stripe_connect_account_id: z.string().regex(/^acct_[A-Za-z0-9]+$/, "a Stripe account id (acct_...)").nullable(),
  published: z.boolean(),
  url: z.url().startsWith("https://", "https only").nullable(),
  tagline: z.string().trim().max(280).nullable(),
  states: z.array(z.string().trim().min(1).max(64)).max(100),
  serves: z.array(z.enum(PARTNER_SERVES)).max(PARTNER_SERVES.length),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /** Per-request acknowledgement for publishing a coop / unincorporated org. */
  publish_unverified_ack: z.boolean(),
}

export const CreatePartnerOrgBody = z
  .object({
    key: keySchema,
    name: writable.name,
    org_type: writable.org_type.optional(),
    ein: writable.ein.optional(),
    relationship: writable.relationship.optional(),
    fiscal_host_key: writable.fiscal_host_key.optional(),
    stripe_connect_account_id: writable.stripe_connect_account_id.optional(),
    published: writable.published.optional(),
    url: writable.url.optional(),
    tagline: writable.tagline.optional(),
    states: writable.states.optional(),
    serves: writable.serves.optional(),
    metadata: writable.metadata.optional(),
    publish_unverified_ack: writable.publish_unverified_ack.optional(),
  })
  .strict()

export const PatchPartnerOrgBody = CreatePartnerOrgBody.omit({ key: true }).partial().strict()

export type CreatePartnerOrgBody = z.infer<typeof CreatePartnerOrgBody>
export type PatchPartnerOrgBody = z.infer<typeof PatchPartnerOrgBody>

/** The verification columns present in a raw body, if any. */
export function verificationFieldsInBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return []
  const keys = Object.keys(body as Record<string, unknown>)
  return PARTNER_ORG_VERIFICATION_FIELDS.filter((f) => keys.includes(f))
}

/**
 * Handler-level flag check. `middlewares.ts` gates the matcher with
 * `requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")`; this repeats the
 * same 404 inside the handler so a matcher typo cannot open the route, and
 * so the route's own spec can prove the gate without booting the app.
 */
export function featureDisabled(res: MedusaResponse): boolean {
  if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return false
  res.status(404).json({
    type: "feature_disabled",
    message: `Feature flag ${PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1} is disabled`,
  })
  return true
}

export function rejectBody(res: MedusaResponse, body: unknown, error: z.ZodError): MedusaResponse {
  const verification = verificationFieldsInBody(body)
  if (verification.length > 0) {
    return res.status(400).json({
      type: "verification_fields_are_ingest_only",
      message:
        `${verification.join(", ")} cannot be set here. Verification is written only by the IRS-file ingest ` +
        "(POST /admin/partners/orgs/:key/verify once it ships); an operator-typed status would be BMC asserting a third party's tax status (L11).",
      fields: verification,
    })
  }
  return res.status(400).json({
    type: "invalid_request",
    message: "Invalid partner org payload",
    errors: z.flattenError(error),
  })
}

/** Map service errors onto HTTP. Anything else rethrows to the framework handler. */
export function sendServiceError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (!MedusaError.isMedusaError(error)) throw error
  const medusaError = error as MedusaError & { code?: string }
  switch (medusaError.type) {
    case MedusaError.Types.NOT_FOUND:
      return res.status(404).json({ type: "not_found", message: medusaError.message })
    case MedusaError.Types.DUPLICATE_ERROR:
      return res.status(409).json({ type: "duplicate", message: medusaError.message })
    case MedusaError.Types.INVALID_DATA:
      return res.status(400).json({ type: "invalid_request", message: medusaError.message })
    case MedusaError.Types.NOT_ALLOWED:
      return res.status(409).json({
        type: "publish_refused",
        code: medusaError.code ?? null,
        message: medusaError.message,
      })
    default:
      throw error
  }
}

/** Response envelope for one org; the MOU notice rides along whenever the row is published (L18). */
export function orgResponse(org: PartnerOrgRecord): { org: PartnerOrgRecord; notice?: string } {
  return org.published ? { org, notice: PUBLISH_MOU_NOTICE } : { org }
}
