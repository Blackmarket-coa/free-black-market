import { model } from "@medusajs/framework/utils"

/**
 * A short-lived Blackout subscription manage session (operator answer
 * 2026-10-06, item 21; docs/contracts/blackout-integration.md, "Blackout
 * subscription self-service").
 *
 * Blackout mints one, server to server, for exactly one member; FBM hands
 * back a URL to an FBM-hosted page where that member turns automatic renewal
 * off or on, or cancels. The URL carries an opaque 32-byte random token; only
 * its sha256 is stored here (`token_hash`), so a read of this table cannot be
 * replayed as a link. It is not a JWT and never a customer session on /store.
 *
 * `customer_id` is bound once, at mint, by a READ-ONLY lookup on
 * `customer.metadata.blackout_user_id` (never by mxid, never creating a
 * customer). Null means the member has no FBM customer yet: the page lists
 * nothing. More than one match is refused at mint (409 identity_ambiguous).
 *
 * `csrf_nonce_hash` is the sha256 of the nonce the page renders into its own
 * script and every action POST must echo; the nonce is derived from the
 * token, so it is bound to this one session.
 *
 * Lifetime: `expires_at` is absolute (15 minutes, no sliding extension). A new
 * mint for the same member stamps `revoked_at` on every earlier row, and the
 * partial unique index below holds that at the database: at most one
 * unrevoked session per Blackout user.
 */
const BlackoutManageSession = model
  .define("blackout_manage_session", {
    id: model.id({ prefix: "bms" }).primaryKey(),

    blackout_user_id: model.text(),
    customer_id: model.text().nullable(),

    token_hash: model.text(),
    csrf_nonce_hash: model.text(),

    expires_at: model.dateTime(),
    revoked_at: model.dateTime().nullable(),

    /** Accepted only when its origin is in BLACKOUT_RETURN_ORIGINS; else null. */
    return_url: model.text().nullable(),
  })
  .indexes([
    {
      on: ["token_hash"],
      name: "UQ_blackout_manage_session_token_hash",
      unique: true,
      where: '"deleted_at" IS NULL',
    },
    {
      on: ["blackout_user_id"],
      name: "UQ_blackout_manage_session_live_user",
      unique: true,
      where: '"revoked_at" IS NULL AND "deleted_at" IS NULL',
    },
  ])

export default BlackoutManageSession
