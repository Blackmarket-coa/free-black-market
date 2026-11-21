import type { MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ISO_DATE_PATTERN,
  JURISDICTION_PROGRAMS,
  JurisdictionRuleError,
  RULE_KEY_PATTERN,
  RULE_KINDS,
  SHA256_PATTERN,
} from "../../../modules/jurisdiction-rules"

/**
 * Shared pieces for `/admin/jurisdiction-rules`, `/admin/jurisdiction-sources`
 * and `/admin/jurisdiction-coverage` (not a route file; Medusa's loader mounts
 * only `route.ts`).
 *
 * The body schemas check shape and type. What makes a draft a usable rule (at
 * least one citation, a quote for every kind but `not_stated`, a source on
 * file for the jurisdiction) is decided once, in the module
 * (`rule-draft.ts`, `service.ts`), and relayed from there as a 400, so the
 * route and the seed are held to the same rules.
 */

const CitationBody = z
  .object({
    source_id: z.string().trim().min(1).max(200),
    locator: z.string().trim().min(1).max(500),
    quote: z.string().min(1).max(10000).nullable().optional(),
  })
  .strict()

/**
 * `.strict()`: an unknown key is a 400. A draft cannot carry a review field,
 * a version number or a hash; those are the service's to write.
 */
export const CreateDraftBody = z
  .object({
    jurisdiction_code: z.string().trim().min(1).max(10),
    program: z.enum(JURISDICTION_PROGRAMS).optional(),
    rule_key: z.string().regex(RULE_KEY_PATTERN, "lowercase words joined by dots, such as label.statement").max(120),
    kind: z.enum(RULE_KINDS),
    value: z.record(z.string(), z.unknown()).nullable().optional(),
    display_text: z.string().trim().min(1).max(10000),
    citations: z.array(CitationBody).max(20),
    effective_from: z.string().regex(ISO_DATE_PATTERN, "a calendar date as YYYY-MM-DD").nullable().optional(),
    effective_note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()

/**
 * Not strict, on purpose: keys this schema does not name are dropped, not
 * refused. A body that names a reviewer is therefore accepted and the name is
 * ignored; the reviewer recorded is the authenticated admin
 * (`reviewers.ts`). The schema has no reviewer field for a handler to read.
 */
export const ReviewBody = z.object({
  expected_content_sha256: z
    .string()
    .regex(SHA256_PATTERN, "the 64-character lowercase hex hash of the text that was reviewed"),
  note: z.string().trim().max(2000).nullable().optional(),
})

/** Not strict, for the same reason: who withdrew is the authenticated admin. */
export const WithdrawBody = z.object({
  reason: z.string().trim().min(1, "say why this version is being withdrawn").max(2000),
})

export const ListRulesQuery = z.object({
  jurisdiction_code: z.string().trim().min(1).max(10).optional(),
  program: z.enum(JURISDICTION_PROGRAMS).optional(),
  rule_key: z.string().trim().min(1).max(120).optional(),
})

export function rejectBody(res: MedusaResponse, error: z.ZodError): MedusaResponse {
  return res.status(400).json({
    type: "invalid_request",
    message: "Invalid request",
    errors: z.flattenError(error),
  })
}

const STATUS: Record<JurisdictionRuleError["reason"], { status: number; type: string }> = {
  invalid: { status: 400, type: "invalid_request" },
  not_found: { status: 404, type: "not_found" },
  not_opened: { status: 409, type: "jurisdiction_not_opened" },
  stale: { status: 409, type: "stale_review" },
  conflict: { status: 409, type: "conflict" },
  integrity: { status: 409, type: "content_hash_mismatch" },
  closed: { status: 500, type: "not_available" },
}

/** Map the module's refusals onto HTTP. Anything else rethrows to the framework's handler. */
export function sendRuleError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (!(error instanceof JurisdictionRuleError)) throw error
  const { status, type } = STATUS[error.reason]
  return res.status(status).json({
    type,
    message: error.message,
    ...(error.details.length > 0 ? { errors: error.details } : {}),
  })
}
