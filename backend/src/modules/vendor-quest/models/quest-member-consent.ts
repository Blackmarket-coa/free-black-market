import { model } from "@medusajs/framework/utils"

/**
 * Quest Member Consent — explicit, scoped consent for a vendor to contribute
 * their substrate to a collective quest.
 *
 * Consent is per-member and per-scope (`consent_scopes` lists which substrate
 * areas the member allows to be aggregated, e.g. ["revenue","operating"]).
 * Aggregation reads a member's data ONLY while an un-revoked consent row exists
 * covering the needed scope. Revoking stamps `revoked_at`; the member's own
 * records are untouched.
 */
const QuestMemberConsent = model.define("quest_member_consent", {
  id: model.id().primaryKey(),

  collective_id: model.text(),
  seller_id: model.text(),

  // Substrate areas the member consents to aggregate. Empty ⇒ no consent.
  consent_scopes: model.json(), // string[]

  consented_at: model.dateTime(),
  revoked_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["collective_id"], name: "IDX_quest_member_consent_collective_id" },
    { on: ["seller_id"], name: "IDX_quest_member_consent_seller_id" },
  ])

export default QuestMemberConsent
