import { model } from "@medusajs/framework/utils"

/**
 * Attestation
 *
 * Links an `AssetDeclaration` to a verification claim. v0 covers three
 * tiers; the `external` JSON slot reserves room for W3C Verifiable
 * Credential payloads in v0.1 (didkit / veramo or equivalent).
 *
 * The existing `vendor_verification` module supplies `seller-id`-anchored
 * verification at the producer level (UNVERIFIED → SELF_REPORTED →
 * VERIFIED → AUDITED → CERTIFIED). This model is at the declaration
 * level — finer-grained, attached to specific declared assets — and is
 * complementary, not parallel. In v0.1 a workflow can map producer-level
 * verifications into peer or third-party attestations on the
 * declarations the seller makes.
 */
const Attestation = model.define("attestation", {
  id: model.id().primaryKey(),

  /** FK to `asset_declaration.id`. */
  declaration_id: model.text(),

  /**
   * One of: self-declared | peer-vouched | third-party-attested.
   * Aligns with the verification ladder used by `vendor_verification`
   * but operates at the per-declaration grain.
   */
  tier: model.text(),

  /**
   * Member id of the attestor for peer-vouched. Null for self-declared
   * (the declarer is the attestor) and for third-party-attested (the
   * issuer is captured in `external`).
   */
  attestor_member_id: model.text().nullable(),

  /**
   * Third-party issuer payload. JSON shape (v0):
   *   { issuer: string, credential_id?: string, verification_url?: string,
   *     vc_payload?: object }
   * `vc_payload` is reserved for W3C Verifiable Credential bodies; v0
   * does not validate it.
   */
  external: model.json().nullable(),

  attested_at: model.dateTime(),

  /** Null = no expiry; otherwise the timestamp at which the claim lapses. */
  expires_at: model.dateTime().nullable(),

  /** Revocation timestamp (null while active). */
  revoked_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["declaration_id"], name: "IDX_attestation_declaration_id" },
  { on: ["tier"], name: "IDX_attestation_tier" },
  { on: ["attestor_member_id"], name: "IDX_attestation_attestor_member_id" },
])

export default Attestation
