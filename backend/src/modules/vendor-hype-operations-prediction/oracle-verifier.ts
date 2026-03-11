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

export const parseTrustedKeysFromEnv = (): Record<string, string> => {
  const raw = process.env.PREDICTION_ORACLE_PUBLIC_KEYS || ""
  const rows = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)

  const keyMap: Record<string, string> = {}
  for (const row of rows) {
    const splitIndex = row.indexOf(":")
    if (splitIndex <= 0) {
      continue
    }
    const id = row.slice(0, splitIndex)
    const pemEncoded = row.slice(splitIndex + 1)
    keyMap[id] = Buffer.from(pemEncoded, "base64").toString("utf-8")
  }

  return keyMap
}

export const verifyOracleEnvelope = (
  input: OracleVerificationInput,
  trustedKeys?: Record<string, string>
) => {
  if (input.algorithm !== "ed25519") {
    return { ok: false, reason: "unsupported_algorithm" as const }
  }

  const now = new Date()
  if (input.signedAt > now || input.expiresAt <= now) {
    return { ok: false, reason: "expired_or_invalid_timestamp" as const }
  }

  const keys = trustedKeys || parseTrustedKeysFromEnv()
  const publicKeyPem = keys[input.keyId]
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
