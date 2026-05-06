import { model } from "@medusajs/framework/utils"

export enum PlatformAccountStatus {
  PENDING = "pending",
  CONNECTED = "connected",
  REAUTH_REQUIRED = "reauth_required",
  REVOKED = "revoked",
}

const PlatformAccount = model
  .define("platform_account", {
    id: model.id().primaryKey(),

    creator_seller_id: model.text(),
    platform: model.text(), // adapter key: tiktok, instagram, youtube, twitch, blackout, rss, custom

    external_account_id: model.text(),
    handle: model.text().nullable(),
    display_name: model.text().nullable(),
    avatar_url: model.text().nullable(),
    follower_count: model.number().default(0),

    // OAuth credentials (encrypted at rest in production — env-driven KMS key)
    access_token_encrypted: model.text().nullable(),
    refresh_token_encrypted: model.text().nullable(),
    token_expires_at: model.dateTime().nullable(),
    scopes: model.json().nullable(),

    // Per-account secret for inbound webhook HMAC (used by webhook-generic
    // adapter and any platform that supports webhook delivery)
    inbound_webhook_secret: model.text().nullable(),

    // Optional: id of the subscription registered on the *external* platform
    webhook_subscription_id: model.text().nullable(),

    status: model
      .enum(Object.values(PlatformAccountStatus))
      .default(PlatformAccountStatus.PENDING),

    last_synced_at: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id", "platform"],
      name: "UQ_platform_account_creator_platform",
      unique: true,
    },
    {
      on: ["platform", "external_account_id"],
      name: "IDX_platform_account_external",
    },
    {
      on: ["status"],
      name: "IDX_platform_account_status",
    },
  ])

export default PlatformAccount
