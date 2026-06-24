import { model } from "@medusajs/framework/utils"

/**
 * XP Attestation
 *
 * Append-only record that a *trusted peer* (the attester) vouched for a
 * contribution by `subject_customer_id`, weighting the XP that contribution is
 * worth. This is the anti-karma-farming control: high-trust XP is earned only
 * when someone other than the subject confirms the value (e.g. a garden
 * coordinator verifying volunteer hours).
 *
 * Mirrors `xp_event`'s audit-trail shape (`source_module`/`source_id`) so an
 * award can always be traced back to the attestation that justified it.
 */
const XpAttestation = model.define("xp_attestation", {
  id: model.id().primaryKey(),

  // Who the XP was awarded to.
  subject_customer_id: model.text(),

  // The trusted peer who vouched. Must differ from the subject.
  attester_customer_id: model.text(),

  // Where the attested contribution came from.
  source_module: model.text().nullable(),
  source_id: model.text().nullable(),

  // The multiplier applied to the base XP (clamped on write).
  weight: model.float(),

  // Slug describing the attested action.
  reason: model.text(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["subject_customer_id"], name: "IDX_xp_attestation_subject" },
    { on: ["attester_customer_id"], name: "IDX_xp_attestation_attester" },
    { on: ["source_module", "source_id"], name: "IDX_xp_attestation_source" },
  ])

export default XpAttestation
