import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
} from "crypto"
import { emitMetric } from "../../lib/instrumentation"
import type { BlackoutSignatureEnvelope } from "./verify"

export interface PluginManifestLike {
  id: string
  version: string
  [key: string]: unknown
}

/**
 * Generalized vendor-event envelope signed with the same Ed25519 keypair
 * used for plugin bundles. The `kind` discriminator is freeform so the
 * signing service stays decoupled from the specific event taxonomy
 * (`order.fulfilled`, `payout.confirmed`, `vendor.verified`, etc.).
 *
 * The envelope shape borrows Sigstore conventions (subject, payloadType,
 * signature) so anyone familiar with supply-chain tooling can read it
 * without the FBM-specific glossary.
 */
export interface VendorEventSignedEnvelope {
  keyId: string
  alg: "ed25519"
  payloadType: string
  payloadHash: string
  subject: string
  signedAt: string
  signature: string
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

  /**
   * Public keys that no longer sign anything but must still verify (W3-2).
   *
   * ## Why this exists
   *
   * The published keyset held exactly one key, derived from whatever private
   * key is configured now. The Blackout client resolves a signature by
   * `keys.find((entry) => entry.keyId === signature.keyId)` and returns
   * `unknown-key-id` when nothing matches
   * (`features/monetization/install/pluginSignature.ts`). So the moment
   * `MARKETPLACE_SIGNING_KEY_ID` changed, **every artifact ever signed under
   * the previous key stopped installing** — not with a warning, with a
   * refusal. Rotation was unavailable in practice, which is the same as
   * having no rotation story at all.
   *
   * The client already treats the document as a keyset. Publishing the
   * retired keys alongside the active one is the whole fix on this side.
   *
   * ## Format
   *
   * `MARKETPLACE_SIGNING_RETIRED_KEYS` is a JSON array:
   *
   * ```json
   * [{ "keyId": "fbm-2025", "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..." }]
   * ```
   *
   * Public keys only. A retired key is for verifying history; nothing here
   * can sign, and `getPrivateKey` is the only path that produces a signature.
   *
   * ## Why this throws rather than skipping a bad entry
   *
   * Dropping a malformed entry would silently stop verifying every artifact
   * signed under it — exactly the outage this function exists to prevent, and
   * one that surfaces as a user's install failing rather than as a deploy
   * failing. A configuration error should be loud at the endpoint (503, with
   * the reason) rather than quiet at the install.
   */
  getRetiredPublicKeys(): Array<{ keyId: string; pem: string }> {
    const raw = process.env.MARKETPLACE_SIGNING_RETIRED_KEYS
    if (!raw || !raw.trim()) {
      return []
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(
        "[marketplace-signing] MARKETPLACE_SIGNING_RETIRED_KEYS must be valid JSON"
      )
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        "[marketplace-signing] MARKETPLACE_SIGNING_RETIRED_KEYS must be a JSON array"
      )
    }

    const activeKeyId = process.env.MARKETPLACE_SIGNING_KEY_ID
    const seen = new Set<string>()

    return parsed.map((entry, index) => {
      const row = entry as { keyId?: unknown; publicKeyPem?: unknown }
      const keyId = typeof row?.keyId === "string" ? row.keyId.trim() : ""
      const pem = typeof row?.publicKeyPem === "string" ? row.publicKeyPem : ""

      if (!keyId || !pem) {
        throw new Error(
          `[marketplace-signing] retired key at index ${index} needs both keyId and publicKeyPem`
        )
      }
      if (keyId === activeKeyId) {
        // Two entries under one keyId make the client's `find` depend on
        // array order, which is not a thing to leave to chance for a
        // signature check.
        throw new Error(
          `[marketplace-signing] retired keyId "${keyId}" is also the active key id`
        )
      }
      if (seen.has(keyId)) {
        throw new Error(`[marketplace-signing] duplicate retired keyId "${keyId}"`)
      }
      seen.add(keyId)

      try {
        // Normalize through the crypto layer so a key that cannot be loaded
        // fails here rather than at a verification months from now.
        const normalized = createPublicKey({ key: pem, format: "pem" })
          .export({ type: "spki", format: "pem" })
          .toString()
        return { keyId, pem: normalized }
      } catch {
        throw new Error(
          `[marketplace-signing] retired key "${keyId}" is not a readable PEM public key`
        )
      }
    })
  }

  sign(args: {
    manifest: PluginManifestLike
    codeSha256: string
    assetHashes: Record<string, string>
    signedAt?: Date
  }): PluginSignedBundle {
    try {
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

      emitMetric("marketplace.signing.success", {
        kind: "plugin_bundle",
        plugin_id: args.manifest.id,
        plugin_version: args.manifest.version,
      })

      return {
        keyId,
        alg: "ed25519",
        manifestHash,
        codeHash: args.codeSha256,
        assetHashes: { ...args.assetHashes },
        signedAt,
        signature,
      }
    } catch (err) {
      emitMetric("marketplace.signing.failure", {
        kind: "plugin_bundle",
        plugin_id: args.manifest.id ?? "unknown",
      })
      throw err
    }
  }

  /**
   * Sign the Blackout-format DISTRIBUTION envelope (W3): the shape the
   * Blackout client's `pluginSignature.ts` verifies — Ed25519 over
   * `${manifestSha256}:${sha256}` — stored on `plugin_version` and served to
   * installers. Same keypair as `sign()`; different signed payload, so both
   * envelopes are minted at publish time (translation is impossible later).
   * The manifest MUST be JSON-clean (no undefined-valued keys) — see
   * verify.ts's canonicalization note.
   */
  signBlackoutEnvelope(args: {
    manifest: PluginManifestLike
    /** Hex SHA-256 of the bundle bytes (manifest_plugin: the declarative payload hash). */
    bundleSha256: string
    issuedAt?: Date
  }): BlackoutSignatureEnvelope {
    try {
      const { keyId, key } = this.getPrivateKey()
      const issuedAt = (args.issuedAt ?? new Date()).toISOString()
      const manifestSha256 = sha256(canonicalJson(args.manifest))
      const payload = `${manifestSha256}:${args.bundleSha256}`
      const signature = cryptoSign(null, Buffer.from(payload, "utf8"), key).toString("base64")

      emitMetric("marketplace.signing.success", {
        kind: "plugin_bundle_v2",
        plugin_id: args.manifest.id,
        plugin_version: args.manifest.version,
      })

      return {
        keyId,
        signature,
        manifestSha256,
        sha256: args.bundleSha256,
        issuedAt,
      }
    } catch (err) {
      emitMetric("marketplace.signing.failure", {
        kind: "plugin_bundle_v2",
        plugin_id: args.manifest.id ?? "unknown",
      })
      throw err
    }
  }

  /**
   * Sign an arbitrary vendor-event payload (orders, payouts, vendor
   * certifications) with the same Ed25519 keypair used for plugin
   * bundles. Subject is a stable identifier for the event (e.g. the
   * order id, the payout id); `kind` is the event taxonomy entry.
   */
  signVendorEvent(args: {
    kind: string
    subject: string
    payload: Record<string, unknown>
    signedAt?: Date
  }): VendorEventSignedEnvelope {
    try {
      const { keyId, key } = this.getPrivateKey()
      const signedAt = (args.signedAt ?? new Date()).toISOString()
      const payloadCanonical = canonicalJson(args.payload)
      const payloadHash = sha256(payloadCanonical)

      const message = [
        SIGNING_PROTOCOL_VERSION,
        args.kind,
        args.subject,
        payloadHash,
        signedAt,
      ].join("|")

      const signature = cryptoSign(null, Buffer.from(message, "utf8"), key).toString("base64")

      emitMetric("marketplace.signing.success", {
        kind: args.kind,
        subject: args.subject,
      })

      return {
        keyId,
        alg: "ed25519",
        payloadType: args.kind,
        payloadHash,
        subject: args.subject,
        signedAt,
        signature,
      }
    } catch (err) {
      emitMetric("marketplace.signing.failure", {
        kind: args.kind,
        subject: args.subject,
      })
      throw err
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
