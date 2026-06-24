import { model } from "@medusajs/framework/utils"

/**
 * Vendor Embed Key
 *
 * A per-vendor publishable key used to authenticate connect.js embeds.
 *
 * Security model:
 *   - The plaintext key (`pk_live_…`) is shown to the vendor exactly ONCE,
 *     at creation time. We persist only its SHA-256 hash (`key_hash`), so a
 *     database leak never exposes usable keys.
 *   - `last_four` is kept purely for display ("pk_live_…a1b2") so a vendor can
 *     recognize which key is which without us storing the secret.
 *   - Revocation is soft: `revoked_at` is stamped instead of deleting the row,
 *     preserving the audit trail and keeping foreign references (analytics)
 *     intact.
 *
 * Origin enforcement is NOT stored here — it reuses the vendor's existing
 * `seller_metadata.connect_domains` allow-list so vendors manage one list.
 */
const VendorEmbedKey = model.define("vendor_embed_key", {
  id: model.id().primaryKey(),

  // MercurJS seller this key belongs to (linked via module link).
  seller_id: model.text(),

  // SHA-256 hex digest of the plaintext key. Unique so a hash collision or
  // duplicate insert is rejected at the DB level.
  key_hash: model.text().unique(),

  // Last 4 chars of the plaintext key, for display only.
  last_four: model.text(),

  // Human-friendly label ("Squarespace site", "Staging").
  label: model.text().nullable(),

  // Soft-revocation timestamp; null while the key is active.
  revoked_at: model.dateTime().nullable(),

  // Best-effort "last seen" timestamp, updated fire-and-forget on use.
  last_used_at: model.dateTime().nullable(),
})
  .indexes([
    {
      on: ["seller_id"],
      name: "IDX_vendor_embed_key_seller_id",
    },
  ])

export default VendorEmbedKey
