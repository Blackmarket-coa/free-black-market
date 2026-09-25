/**
 * `POST /v1/seller/services/subcontracts/:id/deliver` — work-proof signing.
 *
 * Route-handler harness: the exported handler is called directly with
 * hand-rolled req/res and a `scope.resolve` switch. Signing uses a real
 * PluginSigningService (with a generated Ed25519 key when "configured"), so
 * the stored envelopes are genuine; work verification is a recording stub.
 */

import { generateKeyPairSync } from "crypto"
import { POST } from "../route"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../../modules/order-subcontract"
import { WORK_VERIFICATION_MODULE } from "../../../../../../../../modules/work-verification"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../../modules/marketplace-webhooks"
import { MARKETPLACE_SIGNING_MODULE } from "../../../../../../../../modules/marketplace-signing"
import PluginSigningService from "../../../../../../../../modules/marketplace-signing/service"
import {
  verifyWorkProofEnvelope,
  type WorkProofEnvelope,
} from "../../../../../../../../modules/marketplace-signing/work-proof"
import WorkVerificationService from "../../../../../../../../modules/work-verification/service"

const SELLER = "sel_sub"
const SUBCONTRACT = "osc_1"
const PHOTO_SHA = "a".repeat(64)
const LABEL_SHA = "b".repeat(64)

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

function configureKey(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
  process.env.MARKETPLACE_SIGNING_KEY_ID = "fbm-test-1"
  return publicKey.export({ type: "spki", format: "pem" }).toString()
}

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: { proof_ids?: string[]; [key: string]: unknown }
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const makeHarness = (opts: { signingRegistered?: boolean } = {}) => {
  const envelopeWrites: Array<{ id: string; signature_envelope: WorkProofEnvelope }> = []
  const submitted: Array<Record<string, unknown>> = []
  let seq = 0

  const wv = {
    submitProof: jest.fn(async (input: Record<string, unknown>) => {
      submitted.push(input)
      seq += 1
      return { id: `proof_${seq}` }
    }),
    updateProofArtifacts: jest.fn(async (data: Record<string, unknown>) => {
      envelopeWrites.push(data as never)
      return data
    }),
    autoVerify: jest.fn(async () => ({})),
  }
  const subcontracts = {
    listOrderSubcontracts: jest.fn(async () => [
      { id: SUBCONTRACT, subcontract_seller_id: SELLER, parent_seller_id: "sel_parent" },
    ]),
    markDelivered: jest.fn(async () => ({ id: SUBCONTRACT, status: "delivered" })),
  }
  const webhooks = { dispatch: jest.fn(async () => []) }
  const signing = new PluginSigningService()

  const req = {
    params: { id: SUBCONTRACT },
    seller_id: SELLER,
    body: {
      units_delivered: 3,
      proofs: [
        { kind: "photo", sha256: PHOTO_SHA },
        { kind: "shipping_label", sha256: LABEL_SHA },
      ],
    },
    scope: {
      resolve: (key: string) => {
        if (key === ORDER_SUBCONTRACT_MODULE) return subcontracts
        if (key === WORK_VERIFICATION_MODULE) return wv
        if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        if (key === MARKETPLACE_SIGNING_MODULE && opts.signingRegistered !== false) return signing
        throw new Error(`unregistered: ${key}`)
      },
    },
  }

  return { req, wv, subcontracts, envelopeWrites, submitted }
}

const manifestHash = WorkVerificationService.computeManifestHash({
  asset_0: PHOTO_SHA,
  asset_1: LABEL_SHA,
})

const proofRecord = (id: string, kind: string, sha256: string) => ({
  id,
  owner_seller_id: SELLER,
  context_type: "order_subcontract",
  context_id: SUBCONTRACT,
  kind,
  sha256,
})

describe("POST /v1/seller/services/subcontracts/:id/deliver — proof signing", () => {
  it("signs each proof with the marketplace key when MARKETPLACE_SIGNING_* is configured", async () => {
    const publicKeyPem = configureKey()
    const h = makeHarness()
    const res = createRes()

    await POST(h.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.proof_ids).toEqual(["proof_1", "proof_2"])
    expect(h.envelopeWrites).toHaveLength(2)

    const [photo, label] = h.envelopeWrites
    expect(photo.id).toBe("proof_1")
    expect(photo.signature_envelope).toMatchObject({
      status: "signed",
      unsignedReason: null,
      keyId: "fbm-test-1",
      alg: "ed25519",
      subject: "proof_1",
      manifestHash,
      assetHashes: { asset_0: PHOTO_SHA, asset_1: LABEL_SHA },
    })
    expect(photo.signature_envelope.signature).toEqual(expect.any(String))
    expect(photo.signature_envelope.signature).not.toBe("")

    // Verifiable from what the proof row stores plus the envelope.
    expect(
      verifyWorkProofEnvelope(photo.signature_envelope, {
        proof: proofRecord("proof_1", "photo", PHOTO_SHA),
        publicKeyPem,
      })
    ).toEqual({ ok: true })
    expect(
      verifyWorkProofEnvelope(label.signature_envelope, {
        proof: proofRecord("proof_2", "shipping_label", LABEL_SHA),
        publicKeyPem,
      })
    ).toEqual({ ok: true })
    // A signature is bound to its own proof.
    expect(
      verifyWorkProofEnvelope(photo.signature_envelope, {
        proof: proofRecord("proof_1", "photo", LABEL_SHA),
        publicKeyPem,
      }).ok
    ).toBe(false)
  })

  it("records an explicit unsigned envelope (signature null) when signing keys are unset", async () => {
    const h = makeHarness()
    const res = createRes()

    await POST(h.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.proof_ids).toEqual(["proof_1", "proof_2"])
    expect(h.envelopeWrites).toHaveLength(2)
    for (const write of h.envelopeWrites) {
      expect(write.signature_envelope).toMatchObject({
        status: "unsigned",
        unsignedReason: "signing_unavailable",
        signature: null,
        signedAt: null,
        keyId: null,
        manifestHash,
      })
      expect(write.signature_envelope.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    }
    // Delivery itself is unaffected.
    expect(h.subcontracts.markDelivered).toHaveBeenCalledWith({
      subcontractId: SUBCONTRACT,
      proofId: "proof_1",
      actorSellerId: SELLER,
    })
  })

  it("records unsigned when the signing module is not registered", async () => {
    configureKey()
    const h = makeHarness({ signingRegistered: false })
    const res = createRes()

    await POST(h.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(h.envelopeWrites.map((w) => w.signature_envelope.status)).toEqual([
      "unsigned",
      "unsigned",
    ])
  })

  it("records unsigned (signing_failed) and still delivers when the configured key is unreadable", async () => {
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = "not a pem"
    process.env.MARKETPLACE_SIGNING_KEY_ID = "fbm-test-1"
    const h = makeHarness()
    const res = createRes()

    await POST(h.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(h.envelopeWrites.map((w) => w.signature_envelope.unsignedReason)).toEqual([
      "signing_failed",
      "signing_failed",
    ])
    expect(h.envelopeWrites.every((w) => w.signature_envelope.signature === null)).toBe(true)
    expect(h.subcontracts.markDelivered).toHaveBeenCalled()
  })
})
