import { canonicalJson, sha256, type VendorEventSignedEnvelope } from "./service"
import { verifyVendorEventEnvelope, type VerifyResult } from "./verify"

/**
 * Platform attestation for a work proof (`work-verification` proof artifact).
 *
 * The proof row's `signature_envelope` records what the platform received:
 * the delivery's manifest hash, its asset hashes, and a hash over the proof's
 * identifying fields. When the marketplace signing key is configured that
 * payload is Ed25519-signed as a vendor event (`signVendorEvent`, payloadType
 * `work_proof`, subject = proof id) and `status` is `"signed"`. Without a key
 * the envelope says so — `status: "unsigned"`, `signature: null`,
 * `signedAt: null` — instead of carrying an empty placeholder a reader could
 * take for a signature. Same "always hash, sign when keyed" rule as the karma
 * attestations (hawala-ledger/karma.ts).
 *
 * The signed payload holds only fields the proof row stores verbatim, so a
 * verifier recomputes it from the row plus the envelope's own hashes.
 */

export const WORK_PROOF_PAYLOAD_TYPE = "work_proof"
export const WORK_PROOF_ENVELOPE_VERSION = 1

/** The stored proof-artifact fields the attestation covers. */
export interface WorkProofRecord {
  id: string
  owner_seller_id: string
  context_type: string
  context_id: string
  kind: string
  sha256?: string | null
}

export interface WorkProofBundle {
  manifestHash: string
  assetHashes: Record<string, string>
}

export type WorkProofUnsignedReason = "signing_unavailable" | "signing_failed"

export interface WorkProofEnvelope {
  version: typeof WORK_PROOF_ENVELOPE_VERSION
  status: "signed" | "unsigned"
  /** Why there is no signature: no key configured, or the key failed to sign. */
  unsignedReason: WorkProofUnsignedReason | null
  payloadType: typeof WORK_PROOF_PAYLOAD_TYPE
  subject: string
  payloadHash: string
  manifestHash: string
  assetHashes: Record<string, string>
  keyId: string | null
  alg: "ed25519" | null
  signedAt: string | null
  signature: string | null
}

/** The slice of PluginSigningService this needs (a fake in tests). */
export interface WorkProofSigner {
  isConfigured(): boolean
  signVendorEvent(args: {
    kind: string
    subject: string
    payload: Record<string, unknown>
    signedAt?: Date
  }): VendorEventSignedEnvelope
}

/** The canonical payload a work-proof signature covers. */
export function buildWorkProofPayload(
  proof: WorkProofRecord,
  bundle: WorkProofBundle
): Record<string, unknown> {
  return {
    proof_id: proof.id,
    owner_seller_id: proof.owner_seller_id,
    context_type: proof.context_type,
    context_id: proof.context_id,
    kind: proof.kind,
    sha256: proof.sha256 ?? null,
    manifest_hash: bundle.manifestHash,
    asset_hashes: bundle.assetHashes,
  }
}

/**
 * Build the envelope for one proof: signed when `signer` has a key,
 * explicitly unsigned otherwise. A configured key that fails to sign also
 * yields an unsigned envelope (`signing_failed`, reported via
 * `onSigningError`) — proof submission is best-effort and never blocks the
 * delivery on the attestation.
 */
export function buildWorkProofEnvelope(args: {
  signer: WorkProofSigner | null
  proof: WorkProofRecord
  bundle: WorkProofBundle
  signedAt?: Date
  onSigningError?: (err: unknown) => void
}): WorkProofEnvelope {
  const payload = buildWorkProofPayload(args.proof, args.bundle)
  const unsigned = (reason: WorkProofUnsignedReason): WorkProofEnvelope => ({
    version: WORK_PROOF_ENVELOPE_VERSION,
    status: "unsigned",
    unsignedReason: reason,
    payloadType: WORK_PROOF_PAYLOAD_TYPE,
    subject: args.proof.id,
    payloadHash: sha256(canonicalJson(payload)),
    manifestHash: args.bundle.manifestHash,
    assetHashes: { ...args.bundle.assetHashes },
    keyId: null,
    alg: null,
    signedAt: null,
    signature: null,
  })

  if (!args.signer || !args.signer.isConfigured()) {
    return unsigned("signing_unavailable")
  }

  try {
    const signed = args.signer.signVendorEvent({
      kind: WORK_PROOF_PAYLOAD_TYPE,
      subject: args.proof.id,
      payload,
      signedAt: args.signedAt,
    })
    return {
      version: WORK_PROOF_ENVELOPE_VERSION,
      status: "signed",
      unsignedReason: null,
      payloadType: WORK_PROOF_PAYLOAD_TYPE,
      subject: signed.subject,
      payloadHash: signed.payloadHash,
      manifestHash: args.bundle.manifestHash,
      assetHashes: { ...args.bundle.assetHashes },
      keyId: signed.keyId,
      alg: signed.alg,
      signedAt: signed.signedAt,
      signature: signed.signature,
    }
  } catch (err) {
    args.onSigningError?.(err)
    return unsigned("signing_failed")
  }
}

/**
 * Verify a stored work-proof envelope against the proof row it sits on.
 * Anything not positively signed — an unsigned envelope, or a pre-attestation
 * row whose `signature` is the empty placeholder — fails as `unsigned`.
 */
export function verifyWorkProofEnvelope(
  envelope: Partial<WorkProofEnvelope> | null | undefined,
  args: { proof: WorkProofRecord; publicKeyPem: string }
): VerifyResult {
  if (
    !envelope ||
    envelope.status !== "signed" ||
    !envelope.signature ||
    !envelope.signedAt ||
    !envelope.payloadHash ||
    typeof envelope.manifestHash !== "string" ||
    !envelope.assetHashes
  ) {
    return { ok: false, reason: "unsigned" }
  }
  if (envelope.payloadType !== WORK_PROOF_PAYLOAD_TYPE) {
    return { ok: false, reason: "payload-type-mismatch" }
  }
  if (envelope.subject !== args.proof.id) {
    return { ok: false, reason: "subject-mismatch" }
  }
  return verifyVendorEventEnvelope(
    {
      payloadType: envelope.payloadType,
      subject: envelope.subject,
      payloadHash: envelope.payloadHash,
      signedAt: envelope.signedAt,
      signature: envelope.signature,
    },
    {
      payload: buildWorkProofPayload(args.proof, {
        manifestHash: envelope.manifestHash,
        assetHashes: envelope.assetHashes,
      }),
      publicKeyPem: args.publicKeyPem,
    }
  )
}
