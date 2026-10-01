import { generateKeyPairSync } from "crypto"
import PluginSigningService, { canonicalJson, sha256 } from "../service"
import {
  buildWorkProofEnvelope,
  buildWorkProofPayload,
  verifyWorkProofEnvelope,
  type WorkProofRecord,
} from "../work-proof"

const KEY_ENV = ["MARKETPLACE_SIGNING_PRIVATE_KEY_PEM", "MARKETPLACE_SIGNING_KEY_ID"] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEY_ENV) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEY_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

/** Configure a fresh platform key; returns its public PEM. */
function configureKey(keyId = "fbm-test-1"): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
  process.env.MARKETPLACE_SIGNING_KEY_ID = keyId
  return publicKey.export({ type: "spki", format: "pem" }).toString()
}

const PROOF: WorkProofRecord = {
  id: "proof_1",
  owner_seller_id: "sel_1",
  context_type: "order_subcontract",
  context_id: "osc_1",
  kind: "photo",
  sha256: "a".repeat(64),
}
const BUNDLE = { manifestHash: "m".repeat(64), assetHashes: { asset_0: "a".repeat(64) } }

describe("buildWorkProofEnvelope", () => {
  it("signs with the configured marketplace key, verifiably", () => {
    const publicKeyPem = configureKey()
    const envelope = buildWorkProofEnvelope({
      signer: new PluginSigningService(),
      proof: PROOF,
      bundle: BUNDLE,
      signedAt: new Date("2026-09-25T00:00:00.000Z"),
    })

    expect(envelope).toMatchObject({
      version: 1,
      status: "signed",
      unsignedReason: null,
      payloadType: "work_proof",
      subject: "proof_1",
      keyId: "fbm-test-1",
      alg: "ed25519",
      signedAt: "2026-09-25T00:00:00.000Z",
      manifestHash: BUNDLE.manifestHash,
      assetHashes: BUNDLE.assetHashes,
    })
    expect(envelope.signature).toEqual(expect.any(String))
    expect(envelope.signature).not.toBe("")
    expect(envelope.payloadHash).toBe(sha256(canonicalJson(buildWorkProofPayload(PROOF, BUNDLE))))

    expect(verifyWorkProofEnvelope(envelope, { proof: PROOF, publicKeyPem })).toEqual({ ok: true })
  })

  it("records an explicit unsigned state when no key is configured (no empty-string signature)", () => {
    const envelope = buildWorkProofEnvelope({
      signer: new PluginSigningService(),
      proof: PROOF,
      bundle: BUNDLE,
    })

    expect(envelope).toEqual({
      version: 1,
      status: "unsigned",
      unsignedReason: "signing_unavailable",
      payloadType: "work_proof",
      subject: "proof_1",
      payloadHash: sha256(canonicalJson(buildWorkProofPayload(PROOF, BUNDLE))),
      manifestHash: BUNDLE.manifestHash,
      assetHashes: BUNDLE.assetHashes,
      keyId: null,
      alg: null,
      signedAt: null,
      signature: null,
    })
  })

  it("treats a missing signing module as unavailable", () => {
    expect(buildWorkProofEnvelope({ signer: null, proof: PROOF, bundle: BUNDLE }).status).toBe(
      "unsigned"
    )
  })

  it("falls back to unsigned (signing_failed) when a configured key cannot sign", () => {
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = "not a pem"
    process.env.MARKETPLACE_SIGNING_KEY_ID = "fbm-test-1"
    const onSigningError = jest.fn()

    const envelope = buildWorkProofEnvelope({
      signer: new PluginSigningService(),
      proof: PROOF,
      bundle: BUNDLE,
      onSigningError,
    })

    expect(envelope.status).toBe("unsigned")
    expect(envelope.unsignedReason).toBe("signing_failed")
    expect(envelope.signature).toBeNull()
    expect(onSigningError).toHaveBeenCalledTimes(1)
  })
})

describe("verifyWorkProofEnvelope", () => {
  it("fails unsigned and legacy placeholder envelopes as unsigned", () => {
    const publicKeyPem = configureKey()
    const unsigned = buildWorkProofEnvelope({ signer: null, proof: PROOF, bundle: BUNDLE })
    const legacy = {
      keyId: "platform-default",
      alg: "ed25519",
      manifestHash: BUNDLE.manifestHash,
      assetHashes: BUNDLE.assetHashes,
      signedAt: "2026-08-01T00:00:00.000Z",
      signature: "",
    }

    expect(verifyWorkProofEnvelope(unsigned, { proof: PROOF, publicKeyPem })).toEqual({
      ok: false,
      reason: "unsigned",
    })
    expect(verifyWorkProofEnvelope(legacy as never, { proof: PROOF, publicKeyPem })).toEqual({
      ok: false,
      reason: "unsigned",
    })
    expect(verifyWorkProofEnvelope(null, { proof: PROOF, publicKeyPem }).ok).toBe(false)
  })

  it("rejects a signature once the proof row or the envelope's hashes change", () => {
    const publicKeyPem = configureKey()
    const envelope = buildWorkProofEnvelope({
      signer: new PluginSigningService(),
      proof: PROOF,
      bundle: BUNDLE,
    })

    expect(
      verifyWorkProofEnvelope(envelope, { proof: { ...PROOF, sha256: "b".repeat(64) }, publicKeyPem })
    ).toEqual({ ok: false, reason: "payload-hash-mismatch" })
    expect(
      verifyWorkProofEnvelope(
        { ...envelope, assetHashes: { asset_0: "c".repeat(64) } },
        { proof: PROOF, publicKeyPem }
      )
    ).toEqual({ ok: false, reason: "payload-hash-mismatch" })
    expect(
      verifyWorkProofEnvelope(envelope, { proof: { ...PROOF, id: "proof_2" }, publicKeyPem })
    ).toEqual({ ok: false, reason: "subject-mismatch" })
  })

  it("rejects a signature from a different key", () => {
    configureKey()
    const envelope = buildWorkProofEnvelope({
      signer: new PluginSigningService(),
      proof: PROOF,
      bundle: BUNDLE,
    })
    const otherKeyPem = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString()

    expect(verifyWorkProofEnvelope(envelope, { proof: PROOF, publicKeyPem: otherKeyPem })).toEqual({
      ok: false,
      reason: "signature-mismatch",
    })
  })
})
