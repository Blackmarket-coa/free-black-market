import { createHash, verify } from "crypto"

export type OracleVerificationInput = {
  payload: Record<string, unknown>
  signature: string
  keyId: string
  algorithm: "ed25519"
  nonce: string
  signedAt: Date
  expiresAt: Date
}

export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`
}

export const buildPayloadHash = (payload: Record<string, unknown>): string => {
  return createHash("sha256").update(canonicalize(payload)).digest("hex")
}

const parseTrustedKeys = (): Record<string, string> => {
  const raw = process.env.PREDICTION_ORACLE_PUBLIC_KEYS || ""
  const rows = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)

  const keyMap: Record<string, string> = {}
  for (const row of rows) {
    const [id, pem] = row.split(":")
    if (id && pem) {
      keyMap[id] = Buffer.from(pem, "base64").toString("utf-8")
    }
  }

  return keyMap
}

export const verifyOracleEnvelope = (input: OracleVerificationInput) => {
  if (input.algorithm !== "ed25519") {
    return { ok: false, reason: "unsupported_algorithm" as const }
  }

  const now = new Date()
  if (input.signedAt > now || input.expiresAt <= now) {
    return { ok: false, reason: "expired_or_invalid_timestamp" as const }
  }

  const trustedKeys = parseTrustedKeys()
  const publicKeyPem = trustedKeys[input.keyId]
  if (!publicKeyPem) {
    return { ok: false, reason: "unknown_key_id" as const }
  }

  const payloadHash = buildPayloadHash(input.payload)
  const signatureBytes = Buffer.from(input.signature, "base64")
  const verified = verify(null, Buffer.from(payloadHash), publicKeyPem, signatureBytes)

  if (!verified) {
    return { ok: false, reason: "invalid_signature" as const }
  }

  return { ok: true, payloadHash }
}
