import { MedusaService } from "@medusajs/framework/utils"
import { createHash } from "crypto"
import ProofArtifact, {
  ProofArtifactKind,
  ProofVerificationStatus,
  ProofVerificationMethod,
  ProofContextType,
} from "./models/proof-artifact"

export interface SubmitProofInput {
  ownerSellerId: string
  contextType: ProofContextType
  contextId: string
  contextSecondaryId?: string | null
  kind: ProofArtifactKind
  storageUrl?: string | null
  storageProvider?: string | null
  sha256?: string | null
  capturedAt?: Date | null
  metadata?: Record<string, unknown> | null
}

class WorkVerificationService extends MedusaService({ ProofArtifact }) {
  async submitProof(input: SubmitProofInput): Promise<any> {
    return (this as any).createProofArtifacts({
      owner_seller_id: input.ownerSellerId,
      context_type: input.contextType,
      context_id: input.contextId,
      context_secondary_id: input.contextSecondaryId ?? null,
      kind: input.kind,
      storage_url: input.storageUrl ?? null,
      storage_provider: input.storageProvider ?? null,
      sha256: input.sha256 ?? null,
      captured_at: input.capturedAt ?? new Date(),
      metadata: input.metadata ?? null,
    })
  }

  /**
   * Attach a signed bundle to a proof. The envelope shape mirrors
   * `marketplace-signing.CreatorListingSignatureEnvelope` so the same
   * verification toolchain works for content bundles AND service work.
   */
  async signProof(args: {
    proofId: string
    keyId: string
    manifestHash: string
    signature: string
    assetHashes?: Record<string, string>
  }): Promise<any> {
    const envelope = {
      keyId: args.keyId,
      alg: "ed25519",
      manifestHash: args.manifestHash,
      assetHashes: args.assetHashes ?? {},
      signedAt: new Date().toISOString(),
      signature: args.signature,
    }
    return (this as any).updateProofArtifacts({
      id: args.proofId,
      signature_envelope: envelope,
    })
  }

  async autoVerify(args: {
    proofId: string
    method: ProofVerificationMethod
    verifierId?: string | null
  }): Promise<any> {
    return (this as any).updateProofArtifacts({
      id: args.proofId,
      verification_status: ProofVerificationStatus.AUTO_VERIFIED,
      verification_method: args.method,
      verifier_id: args.verifierId ?? null,
      verified_at: new Date(),
    })
  }

  async manuallyVerify(args: {
    proofId: string
    verifierId: string
    method?: ProofVerificationMethod
  }): Promise<any> {
    return (this as any).updateProofArtifacts({
      id: args.proofId,
      verification_status: ProofVerificationStatus.MANUALLY_VERIFIED,
      verification_method: args.method ?? ProofVerificationMethod.ADMIN_REVIEW,
      verifier_id: args.verifierId,
      verified_at: new Date(),
    })
  }

  async rejectProof(args: {
    proofId: string
    verifierId: string
    reason: string
  }): Promise<any> {
    return (this as any).updateProofArtifacts({
      id: args.proofId,
      verification_status: ProofVerificationStatus.REJECTED,
      verifier_id: args.verifierId,
      verified_at: new Date(),
      rejection_reason: args.reason,
    })
  }

  async disputeProof(proofId: string, reason: string): Promise<any> {
    return (this as any).updateProofArtifacts({
      id: proofId,
      verification_status: ProofVerificationStatus.DISPUTED,
      rejection_reason: reason,
    })
  }

  async listProofsForContext(
    contextType: ProofContextType,
    contextId: string
  ): Promise<any[]> {
    return this.listProofArtifacts({
      context_type: contextType,
      context_id: contextId,
    })
  }

  /**
   * Compute a deterministic manifest hash for a set of asset hashes. Used
   * by callers who want to sign a multi-asset proof without uploading a
   * pre-built manifest file.
   */
  static computeManifestHash(assetHashes: Record<string, string>): string {
    const sorted = Object.keys(assetHashes).sort()
    const lines = sorted.map((k) => `${k}=${assetHashes[k]}`).join("\n")
    return createHash("sha256").update(lines).digest("hex")
  }
}

export default WorkVerificationService
