import { generateKeyPairSync, verify as cryptoVerify, createPublicKey } from "crypto"
import PluginSigningService, {
  canonicalJson,
  sha256,
} from "../service"

function withSigningKey<T>(fn: () => T): T {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const previousPem = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
  const previousKid = process.env.MARKETPLACE_SIGNING_KEY_ID
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
  process.env.MARKETPLACE_SIGNING_KEY_ID = "test-key-1"
  ;(global as any).__test_public_key = publicKey
  try {
    return fn()
  } finally {
    if (previousPem === undefined) delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    else process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = previousPem
    if (previousKid === undefined) delete process.env.MARKETPLACE_SIGNING_KEY_ID
    else process.env.MARKETPLACE_SIGNING_KEY_ID = previousKid
    delete (global as any).__test_public_key
  }
}

describe("PluginSigningService.sign", () => {
  it("produces an envelope that verifies against the configured public key", () => {
    withSigningKey(() => {
      const service = new PluginSigningService()
      const manifest = { id: "com.example.test", version: "1.0.0", title: "T" }
      const envelope = service.sign({
        manifest,
        codeSha256: "a".repeat(64),
        assetHashes: { "img/icon.png": "b".repeat(64) },
        signedAt: new Date("2026-05-05T00:00:00Z"),
      })

      expect(envelope.alg).toBe("ed25519")
      expect(envelope.keyId).toBe("test-key-1")
      expect(envelope.codeHash).toBe("a".repeat(64))
      expect(envelope.assetHashes["img/icon.png"]).toBe("b".repeat(64))

      const publicKey = (global as any).__test_public_key
      const payload = [
        "1",
        envelope.manifestHash,
        envelope.codeHash,
        sha256(canonicalJson(envelope.assetHashes)),
        envelope.signedAt,
      ].join("|")

      const ok = cryptoVerify(
        null,
        Buffer.from(payload, "utf8"),
        publicKey,
        Buffer.from(envelope.signature, "base64")
      )
      expect(ok).toBe(true)
    })
  })

  it("getPublicKeyPem returns a valid SPKI public key", () => {
    withSigningKey(() => {
      const service = new PluginSigningService()
      const { keyId, pem } = service.getPublicKeyPem()
      expect(keyId).toBe("test-key-1")
      const parsed = createPublicKey({ key: pem, format: "pem" })
      expect(parsed.asymmetricKeyType).toBe("ed25519")
    })
  })

  it("manifest canonicalization is order-independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe(canonicalJson([{ a: 2, b: 1 }]))
  })

  it("throws if signing key env vars are missing", () => {
    const prev = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    try {
      const service = new PluginSigningService()
      expect(() =>
        service.sign({
          manifest: { id: "x", version: "1.0.0" },
          codeSha256: "a".repeat(64),
          assetHashes: {},
        })
      ).toThrow(/MARKETPLACE_SIGNING_PRIVATE_KEY_PEM/)
    } finally {
      if (prev !== undefined) process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = prev
    }
  })
})
