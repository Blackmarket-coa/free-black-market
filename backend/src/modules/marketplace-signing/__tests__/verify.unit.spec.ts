import {
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  webcrypto,
} from "crypto"
import PluginSigningService, { canonicalJson, sha256 } from "../service"
import {
  buildPublishingKeysDocument,
  pemToSpkiBase64,
  verifyBlackoutEnvelope,
  verifyPluginBundleEnvelope,
} from "../verify"

function withSigningKey<T>(fn: (publicKeyPem: string) => T): T {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const previousPem = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
  const previousKid = process.env.MARKETPLACE_SIGNING_KEY_ID
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
  process.env.MARKETPLACE_SIGNING_KEY_ID = "test-key-w3"
  try {
    return fn(publicKey.export({ type: "spki", format: "pem" }).toString())
  } finally {
    if (previousPem === undefined) delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    else process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = previousPem
    if (previousKid === undefined) delete process.env.MARKETPLACE_SIGNING_KEY_ID
    else process.env.MARKETPLACE_SIGNING_KEY_ID = previousKid
  }
}

const manifest = {
  id: "coop.fbm.sample-widget",
  name: "Sample",
  version: "1.0.0",
  artifactKind: "manifest_plugin",
  listing: { providerId: "freeblackmarket", providerListingId: "cl_1", publicSlug: "sample" },
}

describe("verifyPluginBundleEnvelope (FBM envelope round-trip)", () => {
  it("verifies a sign() envelope and rejects tampering", () => {
    withSigningKey((publicKeyPem) => {
      const service = new PluginSigningService()
      const assetHashes = { "icon.png": "b".repeat(64) }
      const envelope = service.sign({ manifest, codeSha256: "a".repeat(64), assetHashes })

      expect(
        verifyPluginBundleEnvelope(envelope, {
          manifest,
          codeSha256: "a".repeat(64),
          assetHashes,
          publicKeyPem,
        })
      ).toEqual({ ok: true })

      expect(
        verifyPluginBundleEnvelope(envelope, {
          manifest: { ...manifest, name: "Tampered" },
          codeSha256: "a".repeat(64),
          assetHashes,
          publicKeyPem,
        })
      ).toEqual({ ok: false, reason: "manifest-hash-mismatch" })

      expect(
        verifyPluginBundleEnvelope(envelope, {
          manifest,
          codeSha256: "c".repeat(64),
          assetHashes,
          publicKeyPem,
        })
      ).toEqual({ ok: false, reason: "code-hash-mismatch" })

      expect(
        verifyPluginBundleEnvelope(
          { ...envelope, signature: Buffer.from("forged").toString("base64") },
          { manifest, codeSha256: "a".repeat(64), assetHashes, publicKeyPem }
        ).ok
      ).toBe(false)

      // A stranger's key must not verify the platform's signature.
      const stranger = generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString()
      expect(
        verifyPluginBundleEnvelope(envelope, {
          manifest,
          codeSha256: "a".repeat(64),
          assetHashes,
          publicKeyPem: stranger,
        })
      ).toEqual({ ok: false, reason: "signature-mismatch" })
    })
  })
})

describe("signBlackoutEnvelope + verifyBlackoutEnvelope (distribution envelope)", () => {
  it("round-trips and binds both hashes", () => {
    withSigningKey((publicKeyPem) => {
      const service = new PluginSigningService()
      const bundleSha256 = sha256("declarative-widget-payload")
      const envelope = service.signBlackoutEnvelope({ manifest, bundleSha256 })

      expect(envelope.keyId).toBe("test-key-w3")
      expect(envelope.manifestSha256).toBe(sha256(canonicalJson(manifest)))
      expect(envelope.sha256).toBe(bundleSha256)

      expect(verifyBlackoutEnvelope(envelope, { manifest, bundleSha256, publicKeyPem })).toEqual({
        ok: true,
      })
      expect(
        verifyBlackoutEnvelope(envelope, {
          manifest: { ...manifest, version: "6.6.6" },
          bundleSha256,
          publicKeyPem,
        })
      ).toEqual({ ok: false, reason: "manifest-sha-mismatch" })
      expect(
        verifyBlackoutEnvelope(envelope, {
          manifest,
          bundleSha256: "f".repeat(64),
          publicKeyPem,
        })
      ).toEqual({ ok: false, reason: "bundle-sha-mismatch" })
      expect(
        verifyBlackoutEnvelope(
          { ...envelope, signature: Buffer.from("forged").toString("base64") },
          { manifest, bundleSha256, publicKeyPem }
        ).ok
      ).toBe(false)
    })
  })

  it("passes the Blackout client's own verification recipe (WebCrypto, SPKI import)", async () => {
    await withSigningKey(async (publicKeyPem) => {
      const service = new PluginSigningService()
      const bundleSha256 = sha256("payload-bytes")
      const envelope = service.signBlackoutEnvelope({ manifest, bundleSha256 })

      // Inline reimplementation of blackout pluginSignature.ts: import the
      // base64 SPKI key via WebCrypto and verify Ed25519 over
      // `${manifestSha256}:${sha256}` with a base64 signature.
      const spki = Buffer.from(pemToSpkiBase64(publicKeyPem), "base64")
      const cryptoKey = await webcrypto.subtle.importKey(
        "spki",
        spki,
        { name: "Ed25519" },
        false,
        ["verify"]
      )
      const payload = Buffer.from(`${envelope.manifestSha256}:${envelope.sha256}`, "utf8")
      const verified = await webcrypto.subtle.verify(
        "Ed25519",
        cryptoKey,
        Buffer.from(envelope.signature, "base64"),
        payload
      )
      expect(verified).toBe(true)
    })
  })
})

describe("publishing keys document", () => {
  it("carries a WebCrypto-importable base64 SPKI key plus the PEM", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString()
    const doc = buildPublishingKeysDocument({ keyId: "fbm-2026-q3", pem })
    expect(doc.keys).toHaveLength(1)
    expect(doc.keys[0]).toMatchObject({ keyId: "fbm-2026-q3", alg: "ed25519", publicKeyPem: pem })

    // Round-trip: a signature by the original private key must verify against
    // the DER-reimported public key from the document.
    const reimported = createPublicKey({
      key: Buffer.from(doc.keys[0].publicKey, "base64"),
      format: "der",
      type: "spki",
    })
    expect(reimported.asymmetricKeyType).toBe("ed25519")
    const probe = Buffer.from("probe", "utf8")
    const signature = cryptoSign(null, probe, privateKey)
    expect(cryptoVerify(null, probe, reimported, signature)).toBe(true)
    expect(cryptoVerify(null, Buffer.from("other"), reimported, signature)).toBe(false)
  })
})
