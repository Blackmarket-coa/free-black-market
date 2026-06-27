import { model } from "@medusajs/framework/utils"

/**
 * Client Note — practitioner-only notes attached to a client (and optionally a
 * specific booking). SOAP-style or free-form. These are NEVER shown to the
 * client and never leave the owning seller's scope.
 */
const ClientNote = model.define("wellness_client_note", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  client_profile_id: model.text(),
  booking_id: model.text().nullable(),

  body: model.text(),
  // Private notes (default) are practitioner-only; non-private "public_notes"
  // may be surfaced to the client in a post-session follow-up.
  is_private: model.boolean().default(true),
  author_member_id: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["client_profile_id"], name: "IDX_wellness_client_note_client_profile_id" },
    { on: ["seller_id"], name: "IDX_wellness_client_note_seller_id" },
  ])

export default ClientNote
