import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { WORK_VERIFICATION_MODULE } from "../../../../../modules/work-verification"
import type WorkVerificationService from "../../../../../modules/work-verification/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)
  const filter: Record<string, unknown> = {}
  if (req.query.verification_status)
    filter.verification_status = req.query.verification_status as string
  if (req.query.context_type) filter.context_type = req.query.context_type as string
  if (req.query.context_id) filter.context_id = req.query.context_id as string
  if (req.query.owner_seller_id)
    filter.owner_seller_id = req.query.owner_seller_id as string

  const wv = req.scope.resolve<WorkVerificationService>(WORK_VERIFICATION_MODULE)
  const proofs = await wv.listProofArtifacts(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as const,
  })
  return res.status(200).json({ proofs, limit, offset })
}
