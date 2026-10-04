import type { MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { CarrierRefusalError } from "../../../../modules/hawala-ledger/carrier"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"

/**
 * Shared pieces for the three carrier routes under `/admin/hawala/pools/:id`
 * (not a route file; Medusa's loader only mounts `route.ts`).
 *
 * The bodies are `.strict()`: an unknown key is a 400, so a carrier snapshot,
 * a verification status or a ledger account can never arrive from a request
 * body — the snapshot is built server-side from the directory, and the
 * service strips the carrier columns from every generated write anyway.
 *
 * Amounts are in the pool tables' own unit (major units, as
 * `hawala_investment.amount` is), positive, at most cents precision. The
 * carrier's reference is the idempotency key for the record: never an
 * attempt id, never a UUID minted here.
 */

const amount = z
  .number()
  .finite()
  .positive("amount must be positive")
  .max(1_000_000, "amount exceeds maximum limit")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "amount may carry at most two decimals")

const carrierReference = z.string().trim().min(1).max(200)

export const AssignCarrierBody = z
  .object({
    carrier_org_key: z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/, "a partner org key"),
  })
  .strict()

export const CarrierContributionBody = z
  .object({
    amount,
    carrier_reference: carrierReference,
    customer_id: z.string().trim().min(1).max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const CarrierDistributionBody = z
  .object({
    amount,
    carrier_reference: carrierReference,
    distributed_at: z.iso.datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

/**
 * Handler-level flag check. `middlewares.ts` gates each matcher with
 * `requireFeatureFlagMiddleware("NONPROFIT_PARITY_V1")` (on top of the
 * existing `/admin/hawala/pools*` INVESTMENT_POOLS_V1 gate); this repeats the
 * same 404 inside the handler so a matcher typo cannot open the route.
 */
export function carrierFeatureDisabled(res: MedusaResponse): boolean {
  if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return false
  res.status(404).json({
    type: "feature_disabled",
    message: `Feature flag ${PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1} is disabled`,
  })
  return true
}

export function rejectCarrierBody(res: MedusaResponse, error: z.ZodError): MedusaResponse {
  return res.status(400).json({
    type: "invalid_request",
    message: "Invalid pool carrier payload",
    errors: z.flattenError(error),
  })
}

/**
 * Map service errors onto HTTP. A `CarrierRefusalError` is a 409 whose `type`
 * is the refusal reason (the pool's state, not the caller's access); a
 * missing pool is a 404 (admin routes have no owner check, so no existence
 * oracle is opened — the pool list is already admin-readable). Anything else
 * rethrows to the framework handler.
 */
export function sendCarrierError(res: MedusaResponse, error: unknown): MedusaResponse {
  if (error instanceof CarrierRefusalError) {
    return res.status(409).json({ type: error.reason, message: error.message, details: error.details })
  }
  if (error instanceof Error && error.message === "Investment pool not found") {
    return res.status(404).json({ type: "not_found", message: error.message })
  }
  throw error
}
