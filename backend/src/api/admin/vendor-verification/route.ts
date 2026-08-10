import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { VENDOR_VERIFICATION_MODULE } from "../../../modules/vendor-verification"
import type VendorVerificationService from "../../../modules/vendor-verification/service"
import { CheckStatus } from "../../../modules/vendor-verification/models"

/**
 * GET /admin/vendor-verification
 *
 * The review queue. Until this route existed the admin surface was a funnel
 * dashboard only — counts and a median time-to-verify — with no way to see
 * *which* sellers were waiting or to act on them. Verification could be
 * submitted by vendors and scored by the service, but never actually decided.
 *
 * Query params:
 *   - `status`  filter to verifications having at least one check in this state
 *               (defaults to PENDING + IN_PROGRESS, i.e. the actionable queue)
 *   - `limit` / `offset`  pagination
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorVerificationService>(
    VENDOR_VERIFICATION_MODULE
  )

  const { status, limit = "50", offset = "0" } = req.query as Record<
    string,
    string
  >

  const wanted: string[] = status
    ? [status]
    : [CheckStatus.PENDING, CheckStatus.IN_PROGRESS]

  const verifications = await service.listVendorVerifications({})
  const checks = await service.listVerificationChecks({})

  const checksByVerification = new Map<string, typeof checks>()
  for (const check of checks) {
    const bucket = checksByVerification.get(check.vendor_verification_id) ?? []
    bucket.push(check)
    checksByVerification.set(check.vendor_verification_id, bucket)
  }

  const rows = verifications
    .map((verification) => {
      const own = checksByVerification.get(verification.id) ?? []
      return {
        ...verification,
        checks: own,
        pending_count: own.filter((c) => wanted.includes(c.status)).length,
      }
    })
    .filter((row) => row.pending_count > 0)
    // Oldest waiting first — a review queue that surfaced the newest
    // submissions would let the earliest ones age indefinitely.
    .sort(
      (a, b) =>
        new Date(a.created_at as unknown as string).getTime() -
        new Date(b.created_at as unknown as string).getTime()
    )

  const start = Number(offset) || 0
  const size = Math.min(Number(limit) || 50, 200)

  res.json({
    verifications: rows.slice(start, start + size),
    count: rows.length,
    limit: size,
    offset: start,
  })
}
