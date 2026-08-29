import { createPublicKey, verify as cryptoVerify } from "crypto"
import { canonicalJson, sha256, type PluginSignedBundle } from "./service"

/**
 * Pure verification counterparts to PluginSigningService (W3): FBM signed
 * bundles for two years without being able to verify one. No env access —
 * keys are passed in — so everything here is containerless-testable.
 *
 * Two envelope formats exist, signed by the same platform Ed25519 key:
 *  - the FBM envelope (`1|manifestHash|codeHash|assetHashesHash|signedAt`,
 *    service.sign()) — creator_listing/webhook surface, frozen;
 *  - the Blackout distribution envelope (`${manifestSha256}:${sha256}`,
 *    service.signBlackoutEnvelope()) — what plugin_version stores and the
 *    Blackout client's pluginSignature.ts verifies.
 *
 * Canonical-JSON note: FBM's `canonicalJson` (JSON.stringify over
 * recursively key-sorted values) is byte-identical to the Blackout client's
 * hand-rolled serializer for every JSON-clean value. The one divergence is
 * an object key holding literal `undefined` (we omit it, they serialize the
 * string `undefined`) — so manifests MUST be built without undefined-valued
 * keys (parsed JSON and the distribution-manifest builder both guarantee
 * this).
 */

/**
 * Mirror of `@blackout/protocol` `PluginSignatureEnvelope`: signature is
 * base64 Ed25519 over `manifestSha256:sha256`; hashes are hex SHA-256 of the
 * canonical-JSON manifest and the raw bundle bytes respectively.
 */
export interface BlackoutSignatureEnvelope {
  keyId: string
  signature: string
  manifestSha256: string
  sha256: string
  issuedAt: string
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

function verifyEd25519(payload: string, signatureB64: string, publicKeyPem: string): boolean {
  const key = createPublicKey({ key: publicKeyPem, format: "pem" })
  return cryptoVerify(
    null,
    Buffer.from(payload, "utf8"),
    key,
    Buffer.from(signatureB64, "base64")
  )
}

/**
 * Verify an FBM-format envelope (service.sign() output) against the manifest
 * and hashes it claims to cover.
 */
export function verifyPluginBundleEnvelope(
  envelope: PluginSignedBundle,
  args: {
    manifest: unknown
    codeSha256: string
    assetHashes: Record<string, string>
    publicKeyPem: string
  }
): VerifyResult {
  const manifestHash = sha256(canonicalJson(args.manifest))
  if (manifestHash !== envelope.manifestHash) {
    return { ok: false, reason: "manifest-hash-mismatch" }
  }
  if (args.codeSha256 !== envelope.codeHash) {
    return { ok: false, reason: "code-hash-mismatch" }
  }
  const assetHashesHash = sha256(canonicalJson(args.assetHashes))
  if (assetHashesHash !== sha256(canonicalJson(envelope.assetHashes))) {
    return { ok: false, reason: "asset-hashes-mismatch" }
  }
  const payload = [
    "1",
    envelope.manifestHash,
    envelope.codeHash,
    assetHashesHash,
    envelope.signedAt,
  ].join("|")
  try {
    return verifyEd25519(payload, envelope.signature, args.publicKeyPem)
      ? { ok: true }
      : { ok: false, reason: "signature-mismatch" }
  } catch (err) {
    return {
      ok: false,
      reason: `verification-error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Verify a Blackout-format distribution envelope the way the Blackout client
 * does (pluginSignature.ts): recompute the canonical manifest hash, bind the
 * bundle hash, then Ed25519 over `manifestSha256:sha256`.
 */
export function verifyBlackoutEnvelope(
  envelope: BlackoutSignatureEnvelope,
  args: {
    manifest: unknown
    /** Hex SHA-256 of the bundle bytes; falls back to the envelope's own claim. */
    bundleSha256?: string | null
    publicKeyPem: string
  }
): VerifyResult {
  const manifestSha = sha256(canonicalJson(args.manifest))
  if (manifestSha !== envelope.manifestSha256) {
    return { ok: false, reason: "manifest-sha-mismatch" }
  }
  if (args.bundleSha256 && args.bundleSha256 !== envelope.sha256) {
    return { ok: false, reason: "bundle-sha-mismatch" }
  }
  const payload = `${envelope.manifestSha256}:${envelope.sha256}`
  try {
    return verifyEd25519(payload, envelope.signature, args.publicKeyPem)
      ? { ok: true }
      : { ok: false, reason: "signature-mismatch" }
  } catch (err) {
    return {
      ok: false,
      reason: `verification-error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * PEM → base64 SPKI DER. The Blackout client imports publishing keys via
 * WebCrypto `importKey("spki", …)`, so the well-known document must carry the
 * raw SPKI bytes, not PEM.
 */
export function pemToSpkiBase64(pem: string): string {
  const key = createPublicKey({ key: pem, format: "pem" })
  return key.export({ type: "spki", format: "der" }).toString("base64")
}

/**
 * The `/.well-known/freeblackmarket-publishing-keys.json` document. Array-
 * shaped so key rotation is additive (retired keys append for old bundles).
 * `publicKey` (base64 SPKI) is what the Blackout client consumes;
 * `publicKeyPem` rides along for tooling parity with /v1/marketplace/signing-keys.
 */
export function buildPublishingKeysDocument(args: { keyId: string; pem: string }): {
  keys: Array<{ keyId: string; alg: "ed25519"; publicKey: string; publicKeyPem: string }>
} {
  return {
    keys: [
      {
        keyId: args.keyId,
        alg: "ed25519",
        publicKey: pemToSpkiBase64(args.pem),
        publicKeyPem: args.pem,
      },
    ],
  }
}
