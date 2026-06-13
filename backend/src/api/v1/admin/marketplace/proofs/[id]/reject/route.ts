import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/admin/marketplace/proofs/[id]/reject")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { WORK_VERIFICATION_MODULE } from "../../../../../../../modules/work-verification"
import type WorkVerificationService from "../../../../../../../modules/work-verification/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const Schema = z.object({
  reason: z.string().min(2).max(2000),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid reject payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const wv = req.scope.resolve<WorkVerificationService>(WORK_VERIFICATION_MODULE)
  const list = await wv.listProofArtifacts({ id })
  const proof = list[0]
  if (!proof) {
    return res.status(404).json({ message: "Proof not found", type: "not_found" })
  }
  const updated = await wv.rejectProof({
    proofId: id,
    verifierId: "admin",
    reason: parsed.data.reason,
  })
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch("service.proof.rejected", proof.owner_seller_id, {
      proof_id: id,
      reason: parsed.data.reason,
    })
  } catch (err) {
    log.error("[admin/proof/reject] webhook failed", err)
  }
  return res.status(200).json({ proof: updated })
}
