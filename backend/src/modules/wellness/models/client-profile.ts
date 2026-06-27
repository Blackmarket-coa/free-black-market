import { model } from "@medusajs/framework/utils"

/**
 * Client Profile — the practitioner's CRM record for a client. This is the most
 * sensitive data in the module.
 *
 * SCOPING (CRITICAL): every profile belongs to exactly one `seller_id`. Health
 * / intake / note data is keyed off this row and must NEVER be returned across
 * vendor boundaries. There is one profile per (seller_id, email).
 */
const ClientProfile = model.define("wellness_client_profile", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  customer_id: model.text().nullable(),

  email: model.text(),
  name: model.text().nullable(),
  phone: model.text().nullable(),
  location: model.text().nullable(),
  pronouns: model.text().nullable(),

  // Free-form classification tags (e.g. "Reiki regular", "sound bath fan").
  tags: model.json().nullable(),
  referral_source: model.text().nullable(),

  first_seen_at: model.dateTime().nullable(),
  last_seen_at: model.dateTime().nullable(),

  // Aggregate snapshots (recomputed; not the source of truth).
  lifetime_value_amount: model.number().default(0),
  total_bookings: model.number().default(0),
  no_show_count: model.number().default(0),

  // Blackout Matrix id, for DMs.
  matrix_id: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_wellness_client_profile_seller_id" },
    {
      on: ["seller_id", "email"],
      name: "UQ_wellness_client_profile_seller_email",
      unique: true,
    },
  ])

export default ClientProfile
