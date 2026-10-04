import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ORG_ADVANCE_FEE_RATE_MAX,
  ORG_ADVANCE_FEE_RATE_MIN,
  ORG_ADVANCE_TERM_DAYS_MAX,
  ORG_ADVANCE_TERM_DAYS_MIN,
  OrgAdvanceRefusalError,
  projectOrgAdvanceRecipient,
} from "../../../../../modules/hawala-ledger/org-advance"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"

/**
 * Shared pieces for the three org-advance routes under
 * `/admin/hawala/advances/orgs` (not a route file; Medusa's loader only mounts
 * `route.ts`). Mirrors `admin/hawala/pools/carrier-shared.ts` (S12).
 *
 * The bodies are `.strict()`: an unknown key is a 400, so a recipient
 * snapshot, a verification status, a vendor id, a ledger account or a status
 * can never arrive from a request body — the snapshot is built server-side
 * from the directory and the service writes the rest.
 *
 * Amounts are in the advance tables' own unit (major units, as
 * `hawala_vendor_advance.principal_amount` is), positive, at most cents
 * precision. The operator's references (`disbursement_reference`,
 * `external_reference`) are the idempotency keys: never an attempt id, never
 * a UUID minted here.
 */

const amount = z
  .number()
  .finite()
  .positive("amount must be positive")
  .max(1_000_000, "amount exceeds maximum limit")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "amount may carry at most two decimals")

const reference = z.string().trim().min(1).max(200)

export const RequestOrgAdvanceBody = z
  .object({
    partner_org_key: z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/, "a partner org key"),
    amount,
    fee_rate: z.number().min(ORG_ADVANCE_FEE_RATE_MIN).max(ORG_ADVANCE_FEE_RATE_MAX).optional().default(1.05),
    term_days: z.number().int().min(ORG_ADVANCE_TERM_DAYS_MIN).max(ORG_ADVANCE_TERM_DAYS_MAX).optional().default(30),
    eligibility: z
      .object({
        basis: z.string().trim().min(1).max(1000),
        approved_limit: amount,
      })
      .strict(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const ApproveOrgAdvanceBody = z
  .object({
    disbursement_reference: reference,
  })
  .strict()

export const OrgAdvanceRepaymentBody = z
  .object({
    amount,
    external_reference: reference,
    repaid_at: z.iso.datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

/**
 * Handler-level flag check for BOTH flags. `middlewares.ts` gates the
 * `/admin/hawala/advances/orgs*` matcher with both
 * `requireFeatureFlagMiddleware`s; this repeats the same 404s inside the
 * handler so a matcher typo cannot open the route.
 */
export function orgAdvanceFeatureDisabled(res: MedusaResponse): boolean {
  for (const flag of ["VENDOR_ADVANCES_V1", "NONPROFIT_PARITY_V1"] as const) {
    if (featureFlagState.isEnabled(flag)) continue
    res.status(404).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS[flag]} is disabled`,
    })
    return true
  }
  return false
}

/** The authenticated admin actor, or null. Approval and repayment records name who recorded them. */
export function adminActorId(req: MedusaRequest<unknown>): string | null {
  const ctx = (req as unknown as { auth_context?: { actor_id?: unknown } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id.length > 0 ? ctx.actor_id : null
}

export function rejectOrgAdvanceBody(res: MedusaResponse, error: z.ZodError): MedusaResponse {
  return res.status(400).json({
    type: "invalid_request",
    message: "Invalid org advance payload",
    errors: z.flattenError(error),
  })
}

/**
 * Map service errors onto HTTP. An `OrgAdvanceRefusalError` is a 409 whose
 * `type` is the refusal reason (the advance's state, not the caller's access);
 * a missing advance is a 404 (admin routes have no owner check, so no
 * existence oracle is opened). Anything else rethrows to the framework
 * handler.
 */
export function sendOrgAdvanceError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (error instanceof OrgAdvanceRefusalError) {
    return res.status(409).json({ type: error.reason, message: error.message, details: error.details })
  }
  if (error instanceof Error && error.message === "Vendor advance not found") {
    return res.status(404).json({ type: "not_found", message: error.message })
  }
  throw error
}

type AdvanceRow = {
  id: string
  recipient_type?: string | null
  partner_org_key?: string | null
  recipient_snapshot?: unknown
  principal_amount: unknown
  outstanding_balance: unknown
  total_repaid: unknown
  total_fee_charged?: unknown
  fee_rate: unknown
  term_days: unknown
  start_date?: unknown
  expected_end_date?: unknown
  actual_end_date?: unknown
  status: string
  approved_at?: unknown
  approved_by?: string | null
  disbursement_reference?: string | null
  eligibility_snapshot?: unknown
}

/** The org advance as the admin payload shows it. Never a ledger account (there is none). */
export function serializeOrgAdvance(a: AdvanceRow) {
  return {
    id: a.id,
    recipient_type: a.recipient_type ?? "SELLER",
    partner_org_key: a.partner_org_key ?? null,
    recipient: projectOrgAdvanceRecipient(a),
    principal: Number(a.principal_amount),
    outstanding: Number(a.outstanding_balance),
    repaid: Number(a.total_repaid),
    fee_charged: Number(a.total_fee_charged ?? 0),
    fee_rate: Number(a.fee_rate),
    term_days: Number(a.term_days),
    start_date: a.start_date ?? null,
    expected_end_date: a.expected_end_date ?? null,
    actual_end_date: a.actual_end_date ?? null,
    status: a.status,
    approved_at: a.approved_at ?? null,
    approved_by: a.approved_by ?? null,
    disbursement_reference: a.disbursement_reference ?? null,
    eligibility: a.eligibility_snapshot ?? null,
  }
}
