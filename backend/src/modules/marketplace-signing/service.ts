import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
} from "crypto"

export interface PluginManifestLike {
  id: string
  version: string
  [key: string]: unknown
}

export interface PluginSignedBundle {
  keyId: string
  alg: "ed25519"
  manifestHash: string
  codeHash: string
  assetHashes: Record<string, string>
  signedAt: string
  signature: string
}

const SIGNING_PROTOCOL_VERSION = "1"

/**
 * PluginSigningService
 *
 * Produces an Ed25519 signature envelope over a manifest + code blob + asset
 * hashes. The envelope shape mirrors `@blackout/protocol`'s
 * `PluginSignatureEnvelope`, so the BlackOut client's `pluginSignature.ts`
 * verifier can validate bundles signed here against the pinned public key.
 *
 * Canonicalization: all hashed inputs are SHA-256(JSON-with-sorted-keys);
 * the signed payload concatenates `${PROTOCOL_VERSION}|${manifestHash}|${codeHash}|${assetHashesHash}|${signedAt}`.
 */
class PluginSigningService {
  private getPrivateKey(): { keyId: string; key: KeyObject } {
    const pem = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    const keyId = process.env.MARKETPLACE_SIGNING_KEY_ID

    if (!pem || !keyId) {
      throw new Error(
        "[marketplace-signing] MARKETPLACE_SIGNING_PRIVATE_KEY_PEM and MARKETPLACE_SIGNING_KEY_ID must be set"
      )
    }

    return {
      keyId,
      key: createPrivateKey({ key: pem, format: "pem" }),
    }
  }

  /**
   * Returns the configured public key in PEM form for verification by the
   * BlackOut client (the client pins this value at build time).
   */
  getPublicKeyPem(): { keyId: string; pem: string } {
    const { keyId, key } = this.getPrivateKey()
    const pub = createPublicKey(key)
    return {
      keyId,
      pem: pub.export({ type: "spki", format: "pem" }).toString(),
    }
  }

  sign(args: {
    manifest: PluginManifestLike
    codeSha256: string
    assetHashes: Record<string, string>
    signedAt?: Date
  }): PluginSignedBundle {
    const { keyId, key } = this.getPrivateKey()
    const signedAt = (args.signedAt ?? new Date()).toISOString()

    const manifestHash = sha256(canonicalJson(args.manifest))
    const assetHashesHash = sha256(canonicalJson(args.assetHashes))

    const payload = [
      SIGNING_PROTOCOL_VERSION,
      manifestHash,
      args.codeSha256,
      assetHashesHash,
      signedAt,
    ].join("|")

    const signature = cryptoSign(null, Buffer.from(payload, "utf8"), key)
      .toString("base64")

    return {
      keyId,
      alg: "ed25519",
      manifestHash,
      codeHash: args.codeSha256,
      assetHashes: { ...args.assetHashes },
      signedAt,
      signature,
    }
  }
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex")
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

export default PluginSigningService
