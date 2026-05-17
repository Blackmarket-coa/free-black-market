import { model } from "@medusajs/framework/utils"

/**
 * EscrowAgreement
 *
 * Stellar 2-of-3 multisig escrow with pre-authorized time-locked recovery.
 * The three signers are buyer / vendor / FBM arbitrator; release requires
 * any two. The recovery transaction is pre-signed at funding time with a
 * `not_before` time bound so neither party can drain prematurely.
 *
 * Polymorphic linkage via `subject_type` + `subject_id` avoids circular
 * FK dependencies on modules that may land in later branches (Bounty,
 * Campaign). A CHECK constraint enforces the allowed subject types.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md` for the Posture A custodial role
 * the platform arbitrator plays (and why the time-lock matters).
 */
const EscrowAgreement = model.define("hawala_escrow_agreement", {
  id: model.id().primaryKey(),

  /** pending | funded | released | disputed | recovered. */
  state: model.text().default("pending"),

  /** order | bounty | campaign | service_engagement. CHECK constraint at the DB. */
  subject_type: model.text(),
  subject_id: model.text(),

  /** Link to the LedgerAccount that holds escrowed funds on Stellar. */
  stellar_account_id: model.text(),

  /** 3 signer public keys (Stellar ed25519). */
  signers_json: model.json(),

  /** Multisig threshold; always 2 in v1 (2-of-3). */
  threshold: model.number().default(2),

  /** Earliest time the recovery transaction may be submitted. */
  recovery_unlock_at: model.dateTime().nullable(),

  /** Public key of the recovery signer (platform-held under Posture A). */
  recovery_signer_pubkey: model.text().nullable(),

  /** Escrowed amount. */
  amount: model.float(),
  currency_code: model.text(),

  /** Set when state transitions to `released`. */
  released_at: model.dateTime().nullable(),

  /** Set when state transitions to `recovered`. */
  recovered_at: model.dateTime().nullable(),

  /** Set when state transitions to `disputed`; freeform external reference. */
  dispute_id: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["subject_type", "subject_id"], name: "IDX_escrow_subject" },
  { on: ["state"], name: "IDX_escrow_state" },
  { on: ["stellar_account_id"], name: "IDX_escrow_stellar_account_id" },
])

export default EscrowAgreement
