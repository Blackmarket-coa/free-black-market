/**
 * W3C Verifiable Credential payload validation.
 *
 * The Attestation model's `external` JSON column carries the optional
 * `vc_payload` field for third-party-attested declarations. This file
 * is the parser of truth for that payload.
 *
 * Scope is structural: parse the VC body, extract the issuer, subject,
 * claims, and validity window. **Cryptographic proof verification
 * (data integrity proofs, JWT signatures, DID resolution) is out of
 * scope for v0.1** — that requires didkit / veramo or equivalent and
 * lives in its own workstream. v0.1 catches malformed payloads and
 * gives downstream code a typed view into a well-formed one.
 *
 * The schema follows the W3C Verifiable Credentials Data Model 2.0
 * (https://www.w3.org/TR/vc-data-model-2.0/) but is permissive: it
 * accepts both v1 (`@context: "https://www.w3.org/2018/credentials/v1"`)
 * and v2 (`https://www.w3.org/ns/credentials/v2`) contexts because
 * many real-world issuers still emit v1.
 *
 * The cluster-3 childcare manifest's `credential.cpr-certified` and
 * `credential.background-check` declarations are the v0.1 use cases
 * this unblocks.
 */

import { z } from "zod"

/**
 * Issuer can be a string DID/URL or an object with at least `id`.
 * Many real issuers attach a display name.
 */
const Issuer = z.union([
  z.string().min(1),
  z
    .object({
      id: z.string().min(1),
      name: z.string().optional(),
    })
    .passthrough(),
])

/**
 * credentialSubject can be a single subject or an array. v0.1 normalizes
 * downstream via `getCredentialSubjects`.
 */
const CredentialSubject = z
  .object({
    /**
     * Subject DID/URL. Optional per spec — a credential about an
     * unidentified subject can omit it. For attestations on FBM, we
     * expect it to be present (the BMC member id).
     */
    id: z.string().optional(),
  })
  .catchall(z.unknown())

/**
 * Allow either v1 or v2 W3C credentials context, plus arbitrary extra
 * contexts the issuer may add.
 */
const ContextEntry = z.union([z.string(), z.record(z.string(), z.unknown())])
const Context = z.union([ContextEntry, z.array(ContextEntry).min(1)])

/**
 * Type can be a single string or an array; spec requires
 * "VerifiableCredential" to be present.
 */
const TypeArray = z.array(z.string().min(1)).min(1).refine(
  (t) => t.includes("VerifiableCredential"),
  { message: "type must include 'VerifiableCredential'" }
)
const Type = z.union([
  z.literal("VerifiableCredential"),
  TypeArray,
])

/** Proof block — kept opaque in v0.1 (verification is deferred). */
const Proof = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.record(z.string(), z.unknown())),
])

export const VerifiableCredentialSchema = z
  .object({
    "@context": Context,
    type: Type,
    issuer: Issuer,
    credentialSubject: z.union([CredentialSubject, z.array(CredentialSubject).min(1)]),

    /** Spec id (URL/DID); optional. */
    id: z.string().optional(),

    /**
     * v2: validFrom / validUntil. v1 uses issuanceDate / expirationDate.
     * Accept either.
     */
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    issuanceDate: z.string().datetime().optional(),
    expirationDate: z.string().datetime().optional(),

    proof: Proof.optional(),
  })
  .passthrough()

export type VerifiableCredential = z.infer<typeof VerifiableCredentialSchema>

export type VCParseResult =
  | { ok: true; vc: VerifiableCredential }
  | { ok: false; errors: string[] }

/**
 * Safe parser. Returns a discriminated union rather than throwing so
 * callers can decide whether a malformed VC blocks the write or
 * surfaces as a flag on the attestation.
 */
export const parseVerifiableCredential = (
  payload: unknown
): VCParseResult => {
  const result = VerifiableCredentialSchema.safeParse(payload)
  if (result.success) {
    return { ok: true, vc: result.data }
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`
    ),
  }
}

/** Extract issuer id (the DID/URL), regardless of object/string form. */
export const getIssuerId = (vc: VerifiableCredential): string => {
  if (typeof vc.issuer === "string") return vc.issuer
  return vc.issuer.id
}

/** Always returns an array of subjects. */
export const getCredentialSubjects = (
  vc: VerifiableCredential
): ReadonlyArray<z.infer<typeof CredentialSubject>> => {
  const cs = vc.credentialSubject
  return Array.isArray(cs) ? cs : [cs]
}

/**
 * Effective validity window. v2's validFrom/validUntil takes
 * precedence; falls back to v1's issuanceDate/expirationDate.
 * Returns Date objects when present, null otherwise.
 */
export const getValidityWindow = (
  vc: VerifiableCredential
): { from: Date | null; until: Date | null } => {
  const fromStr = vc.validFrom ?? vc.issuanceDate ?? null
  const untilStr = vc.validUntil ?? vc.expirationDate ?? null
  return {
    from: fromStr ? new Date(fromStr) : null,
    until: untilStr ? new Date(untilStr) : null,
  }
}

/** True iff `now` falls inside the credential's validity window. */
export const isCurrentlyValid = (
  vc: VerifiableCredential,
  now: Date = new Date()
): boolean => {
  const { from, until } = getValidityWindow(vc)
  if (from && now < from) return false
  if (until && now > until) return false
  return true
}

/**
 * Whether the supplied JSON looks like a VC payload at all (used by
 * the service to decide if VC-specific validation should run on
 * `Attestation.external`). A non-VC `external` (legacy / pre-VC
 * issuers with just `{ issuer, credential_id, verification_url }`)
 * is also valid and bypasses VC parsing.
 */
export const looksLikeVCPayload = (payload: unknown): boolean => {
  if (!payload || typeof payload !== "object") return false
  return "type" in (payload as Record<string, unknown>) ||
    "credentialSubject" in (payload as Record<string, unknown>) ||
    "@context" in (payload as Record<string, unknown>)
}

export class VerifiableCredentialError extends Error {
  constructor(message: string, public readonly errors: string[]) {
    super(message)
    this.name = "VerifiableCredentialError"
  }
}
