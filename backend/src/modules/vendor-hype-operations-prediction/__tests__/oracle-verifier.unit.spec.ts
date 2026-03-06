import { generateKeyPairSync, sign } from "crypto"
import { buildPayloadHash, verifyOracleEnvelope } from "../oracle-verifier"

describe("oracle-verifier", () => {
  it("verifies an ed25519 signature over canonical payload hash", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString("utf-8")
    process.env.PREDICTION_ORACLE_PUBLIC_KEYS = `k1:${Buffer.from(publicPem, "utf-8").toString("base64")}`

    const payload = { b: 2, a: 1 }
    const payloadHash = buildPayloadHash(payload)
    const signature = sign(null, Buffer.from(payloadHash), privateKey).toString("base64")

    const result = verifyOracleEnvelope({
      payload,
      signature,
      keyId: "k1",
      algorithm: "ed25519",
      nonce: "nonce_123456",
      signedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000),
    })

    expect(result.ok).toBe(true)
  })
})
