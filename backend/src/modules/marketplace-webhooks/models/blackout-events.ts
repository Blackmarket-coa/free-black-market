/**
 * Event types for the Blackout outbound webhook channel (§1-§3 of the
 * FreeBlackMarket -> Blackout work order). These are intentionally kept
 * separate from `MARKETPLACE_WEBHOOK_EVENTS` (the per-seller subscription
 * surface) so the two contracts never bleed into each other: per-seller
 * subscriptions validate against the former, the global Blackout emitter
 * against this set.
 */

/** §2 entitlement-lifecycle / monetization events (closed set). */
export const BLACKOUT_LIFECYCLE_EVENTS = [
  "purchase.succeeded",
  "purchase.failed",
  "purchase.refunded",
  "purchase.chargebacked",
  "creator.payout.completed",
  "listing.signed_bundle.published",
  "creator.account.suspended",
  "referral.attributed",
  "ambassador.commission_paid",
  "quest.reward_settled",
] as const

/** §3 bridge events routed to Matrix rooms. */
export const BLACKOUT_BRIDGE_EVENTS = [
  "order.created",
  "order.updated",
  "order.cancelled",
  "inventory.low",
  "ledger.payment_received",
  "ledger.escrow_released",
  "ledger.refund",
  "ledger.usdc_converted",
  "subscription.activated",
  "subscription.lapsed",
  "dispute.opened",
  "dispute.resolved",
  // §4 companion: emitted on any access/role/membership change so Blackout can
  // re-sync Matrix ACLs promptly instead of waiting for the reconcile poll.
  "entitlements.changed",
] as const

export const BLACKOUT_EVENT_TYPES = [
  ...BLACKOUT_LIFECYCLE_EVENTS,
  ...BLACKOUT_BRIDGE_EVENTS,
] as const

export type BlackoutEventType = (typeof BLACKOUT_EVENT_TYPES)[number]

export function isBlackoutEventType(t: string): t is BlackoutEventType {
  return (BLACKOUT_EVENT_TYPES as readonly string[]).includes(t)
}

/**
 * Subscription kinds for §3 subscription.* events. FBM-side plan keys are
 * mapped onto these Blackout tiers at the emit point.
 */
export const BLACKOUT_SUBSCRIPTION_TIERS = ["signal", "signal_plus", "community"] as const
export type BlackoutSubscriptionTier = (typeof BLACKOUT_SUBSCRIPTION_TIERS)[number]

/**
 * §2 `kind` taxonomy for purchase events. Closed set the Blackout consumer
 * understands; the digital dead-drop fires only for asset_bundle / vault_item /
 * software_license with `metadata.digitalDelivery === true`.
 */
export const BLACKOUT_PURCHASE_KINDS = [
  "emoji_pack",
  "asset_bundle",
  "software_license",
  "plugin_flag",
  "subscription_tier",
  "post_unlock",
  "event_ticket",
  "role_grant",
  "channel_access",
  "profile_cosmetic",
  "sound_pack",
  "community_template",
  "stream_asset",
  "vault_item",
  "privacy_tool",
] as const
export type BlackoutPurchaseKind = (typeof BLACKOUT_PURCHASE_KINDS)[number]
