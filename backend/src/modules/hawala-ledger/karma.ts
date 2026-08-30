import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from "crypto"

// Pure helpers only — safe to import without touching the module container
// (the catalog.ts / compat.ts side-file idiom).
import { canonicalJson, sha256 } from "../marketplace-signing/service"

/**
 * The canonical karma write path (W4, decision D7).
 *
 * `karma_event` is the ecosystem's reputation event log: append-only by
 * convention (no update/delete path is exposed on the write API), deduped at
 * the database by the partial-unique `(source_module, source_id)` index,
 * transfer-prohibited at runtime by the Posture-A rail guard, and — from W4 —
 * source-attributed against the registry below and tamper-evident via a
 * per-event attestation (hashed always; Ed25519-signed when the marketplace
 * signing key is configured, dark otherwise).
 *
 * New writers REGISTER here before emitting. An unregistered `source_module`
 * is a validation failure, which is the point: "one write path" only holds if
 * the vocabulary of sources is closed and reviewable in one place.
 */
export const KARMA_SOURCE_MODULES: Record<string, string> = {
  asset_graph:
    "Settlement reconciler — KARMA-rail settlement records (repair cafés, tool loans, shift covers).",
  progression:
    "XP mirror — every xp_event (grower/wellness ladders) mirrored into the canonical log.",
  reviews: "Marketplace reviews — e.g. a five-star verified review received.",
  vendor_verification:
    "Verification checks passed and badges granted; trust_score stays the derived projection.",
  threshold: "Threshold loan completions (reserved; no writer yet).",
  manual: "Operator grants recorded with an explicit source id.",
}

/** Slug rule shared with the historical vocabulary (`repair-completed`, `grower:order_placed`). */
export const KARMA_REASON_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/

/** Sanity cap — a single event may not move more than this much karma. */
export const MAX_KARMA_DELTA_MAGNITUDE = 10_000

export const KARMA_ATTESTATION_VERSION = 1

export interface KarmaEventInput {
  member_id: string
  /** Signed integer, non-zero, |delta| <= MAX_KARMA_DELTA_MAGNITUDE. */
  delta: number
  reason: string
  /**
   * Registered producer, or null for an operator grant (`operator: true`
   * must be passed explicitly so unattributed writes are always deliberate).
   */
  source_module?: string | null
  source_id?: string | null
  occurred_at?: Date | string
  metadata?: Record<string, unknown> | null
  /** Required (true) when writing without a source_module. */
  operator?: boolean
}

export interface KarmaAttestation {
  version: number
  /** sha256 over the canonical JSON of the event's identifying fields. */
  payload_sha256: string
  signed_at: string
  /** Present only when MARKETPLACE_SIGNING_* is configured. */
  key_id?: string
  /** base64 Ed25519 over `karma|<version>|<payload_sha256>|<signed_at>`. */
  signature?: string
}

export function validateKarmaEventInput(input: KarmaEventInput): string[] {
  const issues: string[] = []
  if (!input.member_id || input.member_id.trim().length === 0) {
    issues.push("member_id is required")
  }
  if (!Number.isInteger(input.delta)) {
    issues.push("delta must be an integer")
  } else if (input.delta === 0) {
    issues.push("delta must be non-zero")
  } else if (Math.abs(input.delta) > MAX_KARMA_DELTA_MAGNITUDE) {
    issues.push(
      `|delta| exceeds the ${MAX_KARMA_DELTA_MAGNITUDE} single-event cap`
    )
  }
  if (!input.reason || !KARMA_REASON_RE.test(input.reason)) {
    issues.push(
      "reason must be a lowercase slug (letters/digits, then :_.- allowed, max 64)"
    )
  }
  const sourceModule = input.source_module ?? null
  const sourceId = input.source_id ?? null
  if (sourceModule === null) {
    if (input.operator !== true) {
      issues.push(
        "source_module is required for system writers; operator grants must pass operator: true"
      )
    }
  } else {
    if (!(sourceModule in KARMA_SOURCE_MODULES)) {
      issues.push(
        `unregistered source_module '${sourceModule}' — register it in hawala-ledger/karma.ts`
      )
    }
    if (sourceId === null || sourceId.trim().length === 0) {
      issues.push("source_id is required when source_module is set")
    }
  }
  if (input.occurred_at !== undefined) {
    const t = new Date(input.occurred_at).getTime()
    if (Number.isNaN(t)) issues.push("occurred_at is not a valid date")
  }
  return issues
}

function attestationPayloadSha256(
  input: KarmaEventInput,
  occurredAtIso: string
): string {
  return sha256(
    canonicalJson({
      member_id: input.member_id,
      delta: input.delta,
      reason: input.reason,
      source_module: input.source_module ?? null,
      source_id: input.source_id ?? null,
      occurred_at: occurredAtIso,
    })
  )
}

function signedPayload(payloadSha256: string, signedAt: string): string {
  return `karma|${KARMA_ATTESTATION_VERSION}|${payloadSha256}|${signedAt}`
}

/**
 * Build the per-event attestation. Always hashes; signs only when the
 * marketplace signing key pair is configured (same env as plugin signing —
 * one platform key), so the write path stays dark without keys.
 */
export function buildKarmaAttestation(
  input: KarmaEventInput,
  occurredAtIso: string,
  now: Date = new Date()
): KarmaAttestation {
  const payload_sha256 = attestationPayloadSha256(input, occurredAtIso)
  const signed_at = now.toISOString()
  const attestation: KarmaAttestation = {
    version: KARMA_ATTESTATION_VERSION,
    payload_sha256,
    signed_at,
  }

  const pem = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
  const keyId = process.env.MARKETPLACE_SIGNING_KEY_ID
  if (pem && keyId) {
    const key = createPrivateKey({ key: pem, format: "pem" })
    attestation.key_id = keyId
    attestation.signature = edSign(
      null,
      Buffer.from(signedPayload(payload_sha256, signed_at), "utf8"),
      key
    ).toString("base64")
  }
  return attestation
}

/**
 * Re-verify an event row against its attestation: the hash must match the
 * stored fields, and when a signature is present it must verify against the
 * given public key (PEM). Returns a reason string on failure.
 */
export function verifyKarmaAttestation(
  event: {
    member_id: string
    delta: number
    reason: string
    source_module?: string | null
    source_id?: string | null
    occurred_at: Date | string
    attestation?: KarmaAttestation | null
  },
  options: { publicKeyPem?: string } = {}
): { ok: boolean; reason?: string } {
  const attestation = event.attestation
  if (!attestation) return { ok: false, reason: "no attestation" }
  const occurredAtIso = new Date(event.occurred_at).toISOString()
  const expected = attestationPayloadSha256(
    {
      member_id: event.member_id,
      delta: event.delta,
      reason: event.reason,
      source_module: event.source_module ?? null,
      source_id: event.source_id ?? null,
    },
    occurredAtIso
  )
  if (expected !== attestation.payload_sha256) {
    return { ok: false, reason: "payload hash mismatch" }
  }
  if (attestation.signature) {
    if (!options.publicKeyPem) {
      return { ok: false, reason: "signature present but no public key given" }
    }
    const ok = edVerify(
      null,
      Buffer.from(
        signedPayload(attestation.payload_sha256, attestation.signed_at),
        "utf8"
      ),
      createPublicKey(options.publicKeyPem),
      Buffer.from(attestation.signature, "base64")
    )
    if (!ok) return { ok: false, reason: "signature mismatch" }
  }
  return { ok: true }
}

/** Postgres unique-violation detector for the `(source_module, source_id)` race. */
export function isKarmaUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === "23505") return true
  return (
    typeof e.message === "string" &&
    (e.message.includes("UQ_karma_event_source") ||
      e.message.toLowerCase().includes("unique constraint"))
  )
}
