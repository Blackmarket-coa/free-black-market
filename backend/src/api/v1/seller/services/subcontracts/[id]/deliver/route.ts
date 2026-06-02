import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../../../modules/order-subcontract/service"
import { WORK_VERIFICATION_MODULE } from "../../../../../../../modules/work-verification"
import WorkVerificationService from "../../../../../../../modules/work-verification/service"
import {
  ProofArtifactKind,
  ProofContextType,
  ProofVerificationMethod,
} from "../../../../../../../modules/work-verification/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const DeliverSchema = z.object({
  units_delivered: z.number().int().min(0).max(1_000_000).optional(),
  proofs: z
    .array(
      z.object({
        kind: z.nativeEnum(ProofArtifactKind),
        storage_url: z.string().url().optional().nullable(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional()
          .nullable(),
        captured_at: z.string().datetime().optional().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional().nullable(),
      })
    )
    .max(32)
    .optional(),
})

/**
 * POST /v1/seller/services/subcontracts/:id/deliver
 *
 * Service vendor marks the subcontract as delivered, attaching one or
 * more proof artifacts (photos, shipping labels, etc.). Each proof gets
 * its `signature_envelope` filled in with a deterministic manifest hash
 * so admins can later verify integrity.
 *
 * The buyer-vendor still needs to call `/accept` to release escrow.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = DeliverSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid deliver payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const list = await service.listOrderSubcontracts({
    id,
    subcontract_seller_id: sellerId,
  })
  const sub = list[0]
  if (!sub) {
    return res.status(404).json({ message: "Subcontract not found", type: "not_found" })
  }

  // Submit proofs (best-effort — don't block delivery on individual proof
  // failures, just log them).
  const proofIds: string[] = []
  let firstProofId: string | null = null
  if (parsed.data.proofs && parsed.data.proofs.length > 0) {
    try {
      const wv = req.scope.resolve<WorkVerificationService>(WORK_VERIFICATION_MODULE)
      // Build asset hashes for the manifest envelope so all submitted proofs
      // are bound together cryptographically.
      const assetHashes: Record<string, string> = {}
      for (let i = 0; i < parsed.data.proofs.length; i++) {
        const p = parsed.data.proofs[i]
        if (p.sha256) assetHashes[`asset_${i}`] = p.sha256
      }
      const manifestHash = WorkVerificationService.computeManifestHash(assetHashes)

      for (const p of parsed.data.proofs) {
        const proof = await wv.submitProof({
          ownerSellerId: sellerId,
          contextType: ProofContextType.ORDER_SUBCONTRACT,
          contextId: id,
          kind: p.kind,
          storageUrl: p.storage_url ?? null,
          storageProvider: "minio",
          sha256: p.sha256 ?? null,
          capturedAt: p.captured_at ? new Date(p.captured_at) : null,
          metadata:
            (p.metadata as Record<string, unknown> | null) ?? null,
        })
        // Attach a signed envelope so the proof can be later audited by
        // anyone who knows the platform's signing key id. We use a
        // pseudo-signature placeholder when no real signing infra is
        // wired up — the manifest hash is what's audit-relevant.
        await wv.signProof({
          proofId: proof.id,
          keyId: process.env.WORK_VERIFICATION_KEY_ID || "platform-default",
          manifestHash,
          signature: "",
          assetHashes,
        })
        // Auto-verify if a carrier-style proof was attached (shipping label
        // or tracking event) — minimal Release E rule profile.
        if (
          p.kind === ProofArtifactKind.SHIPPING_LABEL ||
          p.kind === ProofArtifactKind.TRACKING_EVENT
        ) {
          await wv.autoVerify({
            proofId: proof.id,
            method: ProofVerificationMethod.CARRIER_WEBHOOK,
            verifierId: "system",
          })
        } else if (p.kind === ProofArtifactKind.SIGNED_MANIFEST) {
          await wv.autoVerify({
            proofId: proof.id,
            method: ProofVerificationMethod.SIGNATURE,
            verifierId: "system",
          })
        }
        proofIds.push(proof.id)
        if (!firstProofId) firstProofId = proof.id
      }
    } catch (err) {
      console.error("[subcontract/deliver] proof submission failed", err)
    }
  }

  const updated = await service.markDelivered({
    subcontractId: id,
    proofId: firstProofId,
    actorSellerId: sellerId,
  })

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const payload = {
      subcontract_id: id,
      proof_ids: proofIds,
      units_delivered: parsed.data.units_delivered ?? null,
    }
    await webhooks.dispatch("subcontract.delivered", sellerId, payload)
    await webhooks.dispatch("subcontract.delivered", sub.parent_seller_id, payload)
    for (const proofId of proofIds) {
      await webhooks.dispatch("service.proof.submitted", sellerId, {
        proof_id: proofId,
        subcontract_id: id,
      })
    }
  } catch (err) {
    console.error("[subcontract/deliver] webhook dispatch failed", err)
  }

  return res.status(200).json({ subcontract: updated, proof_ids: proofIds })
}
