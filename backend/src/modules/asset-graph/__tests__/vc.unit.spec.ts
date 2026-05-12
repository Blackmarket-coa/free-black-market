/**
 * W3C Verifiable Credential parser tests.
 *
 * Covers the v0.1 attestation work the cluster-3 childcare appendix
 * flagged: parse a VC body well enough to surface the issuer, the
 * subject, the claims, and the validity window. **No cryptographic
 * proof verification** — that's a separate workstream (didkit /
 * veramo / ssi.js).
 *
 * Test cases mirror the kinds of credentials a future childcare
 * manifest would actually carry: a CPR-certification VC and a
 * background-check VC. Plus the legacy / pre-VC `external` shape that
 * still has to round-trip without VC validation.
 */

import {
  VerifiableCredentialSchema,
  parseVerifiableCredential,
  getIssuerId,
  getCredentialSubjects,
  getValidityWindow,
  isCurrentlyValid,
  looksLikeVCPayload,
  VerifiableCredentialError,
} from "../attestations/vc"

const cprCertVC = (overrides: Record<string, unknown> = {}) => ({
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://example.org/cpr-cert/v1",
  ],
  type: ["VerifiableCredential", "CPRCertification"],
  id: "https://red-cross.example.org/credentials/cpr/12345",
  issuer: {
    id: "did:web:red-cross.example.org",
    name: "American Red Cross",
  },
  validFrom: "2026-01-15T00:00:00Z",
  validUntil: "2028-01-15T00:00:00Z",
  credentialSubject: {
    id: "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
    cprCertified: true,
    levels: ["adult", "child", "infant"],
  },
  proof: {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-rdfc-2022",
    proofValue: "z3MvGcVxzRzzpKF3xHV1n7C9...",
  },
  ...overrides,
})

const backgroundCheckVC = () => ({
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://example.org/background-check/v1",
  ],
  type: ["VerifiableCredential", "BackgroundCheck"],
  issuer: "did:web:checkr.example.com",
  issuanceDate: "2026-04-01T00:00:00Z",
  expirationDate: "2027-04-01T00:00:00Z",
  credentialSubject: {
    id: "did:key:zMember123",
    backgroundCheckCleared: true,
    scope: ["childcare", "elder-care"],
  },
})

describe("VerifiableCredentialSchema (parse)", () => {
  it("parses a minimum-valid VC (string issuer, single subject)", () => {
    const minimal = {
      "@context": "https://www.w3.org/ns/credentials/v2",
      type: "VerifiableCredential",
      issuer: "did:web:issuer.example.com",
      credentialSubject: { id: "did:key:zSubject" },
    }
    const result = parseVerifiableCredential(minimal)
    expect(result.ok).toBe(true)
  })

  it("parses a CPR-certification VC (object issuer, array @context, array type, validity window)", () => {
    const result = parseVerifiableCredential(cprCertVC())
    expect(result.ok).toBe(true)
  })

  it("parses a v1 background-check VC (issuanceDate / expirationDate)", () => {
    const result = parseVerifiableCredential(backgroundCheckVC())
    expect(result.ok).toBe(true)
  })

  it("rejects payload missing @context", () => {
    const broken = cprCertVC()
    delete (broken as any)["@context"]
    const result = parseVerifiableCredential(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("@context"))).toBe(true)
    }
  })

  it("rejects type array missing 'VerifiableCredential'", () => {
    const broken = cprCertVC({ type: ["CPRCertification"] })
    const result = parseVerifiableCredential(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes("VerifiableCredential"))
      ).toBe(true)
    }
  })

  it("rejects empty issuer string", () => {
    const broken = cprCertVC({ issuer: "" })
    const result = parseVerifiableCredential(broken)
    expect(result.ok).toBe(false)
  })

  it("rejects missing credentialSubject", () => {
    const broken = cprCertVC()
    delete (broken as any).credentialSubject
    const result = parseVerifiableCredential(broken)
    expect(result.ok).toBe(false)
  })

  it("rejects malformed validUntil (not ISO 8601)", () => {
    const broken = cprCertVC({ validUntil: "next thursday" })
    const result = parseVerifiableCredential(broken)
    expect(result.ok).toBe(false)
  })

  it("accepts an array of credentialSubjects (multi-subject credential)", () => {
    const multi = cprCertVC({
      credentialSubject: [
        { id: "did:key:zA", cprCertified: true },
        { id: "did:key:zB", cprCertified: true },
      ],
    })
    const result = parseVerifiableCredential(multi)
    expect(result.ok).toBe(true)
  })

  it("passes-through unknown top-level fields (forward-compat)", () => {
    const withExtras = { ...cprCertVC(), credentialStatus: { id: "...", type: "BitstringStatusListEntry" } }
    const result = parseVerifiableCredential(withExtras)
    expect(result.ok).toBe(true)
  })

  it("schema export round-trips via VerifiableCredentialSchema.parse", () => {
    expect(() => VerifiableCredentialSchema.parse(cprCertVC())).not.toThrow()
  })
})

describe("VC extractors", () => {
  it("getIssuerId returns the string issuer verbatim", () => {
    const result = parseVerifiableCredential(backgroundCheckVC())
    if (!result.ok) throw new Error("setup")
    expect(getIssuerId(result.vc)).toBe("did:web:checkr.example.com")
  })

  it("getIssuerId returns issuer.id when issuer is an object", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    expect(getIssuerId(result.vc)).toBe("did:web:red-cross.example.org")
  })

  it("getCredentialSubjects normalizes single-subject to a one-item array", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    const subjects = getCredentialSubjects(result.vc)
    expect(subjects).toHaveLength(1)
    expect(subjects[0].id).toBe(
      "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
    )
  })

  it("getCredentialSubjects returns the array when multi-subject", () => {
    const multi = cprCertVC({
      credentialSubject: [{ id: "did:key:zA" }, { id: "did:key:zB" }],
    })
    const result = parseVerifiableCredential(multi)
    if (!result.ok) throw new Error("setup")
    const subjects = getCredentialSubjects(result.vc)
    expect(subjects.map((s) => s.id)).toEqual(["did:key:zA", "did:key:zB"])
  })

  it("getValidityWindow prefers v2 validFrom/validUntil", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    const { from, until } = getValidityWindow(result.vc)
    expect(from?.toISOString()).toBe("2026-01-15T00:00:00.000Z")
    expect(until?.toISOString()).toBe("2028-01-15T00:00:00.000Z")
  })

  it("getValidityWindow falls back to v1 issuanceDate/expirationDate", () => {
    const result = parseVerifiableCredential(backgroundCheckVC())
    if (!result.ok) throw new Error("setup")
    const { from, until } = getValidityWindow(result.vc)
    expect(from?.toISOString()).toBe("2026-04-01T00:00:00.000Z")
    expect(until?.toISOString()).toBe("2027-04-01T00:00:00.000Z")
  })

  it("getValidityWindow returns nulls when neither pair is present", () => {
    const noWindow = {
      "@context": "https://www.w3.org/ns/credentials/v2",
      type: "VerifiableCredential",
      issuer: "did:web:issuer",
      credentialSubject: { id: "did:key:z" },
    }
    const result = parseVerifiableCredential(noWindow)
    if (!result.ok) throw new Error("setup")
    expect(getValidityWindow(result.vc)).toEqual({ from: null, until: null })
  })
})

describe("isCurrentlyValid", () => {
  it("true for now inside the window", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    expect(isCurrentlyValid(result.vc, new Date("2027-01-01T00:00:00Z"))).toBe(
      true
    )
  })

  it("false for now before validFrom", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    expect(isCurrentlyValid(result.vc, new Date("2025-12-31T00:00:00Z"))).toBe(
      false
    )
  })

  it("false for now after validUntil", () => {
    const result = parseVerifiableCredential(cprCertVC())
    if (!result.ok) throw new Error("setup")
    expect(isCurrentlyValid(result.vc, new Date("2028-06-01T00:00:00Z"))).toBe(
      false
    )
  })

  it("true when no window is set (open-ended credential)", () => {
    const noWindow = {
      "@context": "https://www.w3.org/ns/credentials/v2",
      type: "VerifiableCredential",
      issuer: "did:web:issuer",
      credentialSubject: { id: "did:key:z" },
    }
    const result = parseVerifiableCredential(noWindow)
    if (!result.ok) throw new Error("setup")
    expect(isCurrentlyValid(result.vc)).toBe(true)
  })
})

describe("looksLikeVCPayload (heuristic gate)", () => {
  it("true for a real VC body", () => {
    expect(looksLikeVCPayload(cprCertVC())).toBe(true)
  })

  it("true even for a partial body that mentions @context", () => {
    expect(
      looksLikeVCPayload({
        "@context": "https://www.w3.org/ns/credentials/v2",
      })
    ).toBe(true)
  })

  it("false for legacy issuer-only external blob", () => {
    expect(
      looksLikeVCPayload({
        issuer: "American Red Cross",
        credential_id: "RC-2026-12345",
        verification_url: "https://verify.red-cross.example/12345",
      })
    ).toBe(false)
  })

  it("false for null and primitives", () => {
    expect(looksLikeVCPayload(null)).toBe(false)
    expect(looksLikeVCPayload(undefined)).toBe(false)
    expect(looksLikeVCPayload("a string")).toBe(false)
    expect(looksLikeVCPayload(42)).toBe(false)
  })
})

describe("VerifiableCredentialError", () => {
  it("carries the parser's error list for downstream display", () => {
    const errors = ["@context: Required", "type: Required"]
    const err = new VerifiableCredentialError("VC failed validation", errors)
    expect(err.errors).toEqual(errors)
    expect(err.name).toBe("VerifiableCredentialError")
    expect(err.message).toBe("VC failed validation")
  })
})
