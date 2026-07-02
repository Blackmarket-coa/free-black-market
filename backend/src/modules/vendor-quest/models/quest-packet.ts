import { model } from "@medusajs/framework/utils"

/**
 * Quest Packet — a generated, exportable evidence artifact for a gatekeeper.
 *
 * We persist the structured JSON export (the authoritative form) plus the
 * disclaimer and remaining-items checklist. A rendered HTML/PDF file, when
 * produced, is referenced by `file_id` (Medusa File module). Every packet
 * carries the honest-UI disclaimer: FBM assembled this; the gatekeeper decides.
 */
const QuestPacket = model.define("quest_packet", {
  id: model.id().primaryKey(),

  enrollment_id: model.text(),
  seller_id: model.text(),
  quest_key: model.text(),
  packet_key: model.text(),

  // Authoritative structured export (sections + data). Figures trace to the
  // ledger; never fabricated.
  export_json: model.json().nullable(),

  // Optional rendered artifact reference (HTML/PDF) in the File module.
  file_id: model.text().nullable(),

  disclaimer: model.text(),
  remaining_items: model.json().nullable(), // string[]

  generated_at: model.dateTime(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["enrollment_id"], name: "IDX_quest_packet_enrollment_id" },
    { on: ["seller_id"], name: "IDX_quest_packet_seller_id" },
  ])

export default QuestPacket
