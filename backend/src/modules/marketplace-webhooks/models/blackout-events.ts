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

/**
 * Growth-loop events emitted by the Launch orchestration so the Blackout
 * Creator Hub / home feed can surface new launches and open marketing
 * bounties. FBM only emits these; the Blackout-side consumer is out of scope.
 */
export const BLACKOUT_LAUNCH_EVENTS = [
  "launch.created",
  "bounty.opened",
  "sponsorship.created",
] as const

export const BLACKOUT_EVENT_TYPES = [
  ...BLACKOUT_LIFECYCLE_EVENTS,
  ...BLACKOUT_BRIDGE_EVENTS,
  ...BLACKOUT_LAUNCH_EVENTS,
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
 * Map an FBM subscription onto a Blackout tier. FBM plans are not natively
 * named signal/signal_plus/community, so an explicit `metadata.blackout_tier`
 * wins; otherwise default to `signal`.
 *
 * TODO: replace the default with a real FBM-plan -> Blackout-tier table once
 * plan keys are finalized.
 */
export function mapSubscriptionTier(metadata: unknown): BlackoutSubscriptionTier {
  const t = (metadata as { blackout_tier?: unknown } | null | undefined)?.blackout_tier
  if (typeof t === "string" && (BLACKOUT_SUBSCRIPTION_TIERS as readonly string[]).includes(t)) {
    return t as BlackoutSubscriptionTier
  }
  return "signal"
}

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

/** Kinds whose purchase triggers the digital dead-drop delivery (§2). */
export const BLACKOUT_DEAD_DROP_KINDS: BlackoutPurchaseKind[] = [
  "asset_bundle",
  "vault_item",
  "software_license",
]

/**
 * Map an internal FBM EntitlementKind (digital|access_pass|plugin|theme|
 * emoji_pack|service|other) onto the closest Blackout §2 purchase `kind`.
 * Defaults to `vault_item` (a dead-drop kind) for generic digital goods.
 */
export function mapEntitlementKindToBlackout(
  kind: string | null | undefined
): BlackoutPurchaseKind {
  switch (kind) {
    case "emoji_pack":
      return "emoji_pack"
    case "plugin":
      return "plugin_flag"
    case "theme":
      return "profile_cosmetic"
    case "access_pass":
      return "channel_access"
    case "service":
      return "community_template"
    case "digital":
      return "asset_bundle"
    default:
      return "vault_item"
  }
}
