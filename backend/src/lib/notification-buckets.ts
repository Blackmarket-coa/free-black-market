/**
 * Three-bucket notification classifier.
 *
 * The vendor-panel notifications drawer surfaces a flat list of every
 * notification on the seller's feed. As the surface area grows, that
 * flat list buries the things sellers actually need to act on. This
 * helper splits incoming notifications into three buckets so the UI
 * can show them as tabs and keep the actionable signal up front.
 *
 *   awaits_me — actions you must take. New orders to fulfill, returns
 *               to approve, verification follow-ups, escrow milestones
 *               waiting on your sign-off. Loud. Counts in the drawer
 *               header. Source of FBM's "you owe someone a reply" UX.
 *
 *   about_me  — things that happened TO you. Reviews left, requests
 *               accepted/rejected, payouts sent, refunds processed.
 *               Informational; you can read them at your leisure.
 *
 *   fyi       — broadcasts. Platform announcements, scheduled
 *               maintenance, policy changes. Not personalised; not
 *               counted in the urgency badge.
 *
 * Classification is template-driven. The explicit lists are the source
 * of truth; the substring-pattern fallbacks keep newly-shipped
 * templates in a sensible bucket until they're explicitly classified.
 * Templates that match nothing fall to about_me (the safe default —
 * most notifications are informational).
 *
 * The classifier is pure. The endpoint
 * `backend/src/api/vendor/notifications/buckets/route.ts` calls it for
 * every row on the seller_feed; the vendor-panel drawer reads the
 * resulting bucket counts and per-bucket lists.
 */

export type NotificationBucket = "awaits_me" | "about_me" | "fyi"

export const NOTIFICATION_BUCKETS: readonly NotificationBucket[] = [
  "awaits_me",
  "about_me",
  "fyi",
] as const

export const BUCKET_LABELS: Record<NotificationBucket, string> = {
  awaits_me: "Awaits me",
  about_me: "About me",
  fyi: "FYI",
}

/**
 * Explicit "this template demands action" templates. Add new ones here
 * as the platform surfaces them.
 */
const AWAITS_ME_TEMPLATES = new Set<string>([
  // Mercur native
  "seller_new_order_notification",
  "seller_order_return_requested_notification",
  "seller_order_dispute_opened_notification",
  "seller_verification_action_required_notification",
  // FBM composition-layer (some forward-looking; safe to list)
  "seller_escrow_milestone_review_needed",
  "seller_patronage_request_pending",
  "seller_bargaining_bid_pending_response",
  "seller_collective_pool_commit_window_closing",
])

/**
 * Pattern fallbacks: any template containing one of these substrings
 * is awaits_me. Order matters less than coverage — the goal is to
 * route new templates into the right tab automatically.
 */
const AWAITS_ME_PATTERNS: readonly string[] = [
  "new_order",
  "action_required",
  "approval_needed",
  "approval_required",
  "fulfillment_overdue",
  "dispute_opened",
  "pending_response",
  "review_needed",
  "awaiting_signoff",
]

const FYI_TEMPLATES = new Set<string>([
  "platform_announcement",
  "policy_change_notice",
  "scheduled_maintenance",
  "feature_launched_announcement",
])

const FYI_PATTERNS: readonly string[] = [
  "broadcast_",
  "announcement_",
  "platform_news_",
  "scheduled_maintenance",
]

/**
 * Classify a single template into a bucket. Pure; safe to call from
 * anywhere on the backend or in a worker.
 */
export function classifyNotification(
  template: string | null | undefined
): NotificationBucket {
  if (typeof template !== "string" || template.length === 0) {
    return "about_me"
  }
  if (AWAITS_ME_TEMPLATES.has(template)) return "awaits_me"
  for (const pattern of AWAITS_ME_PATTERNS) {
    if (template.includes(pattern)) return "awaits_me"
  }
  if (FYI_TEMPLATES.has(template)) return "fyi"
  for (const pattern of FYI_PATTERNS) {
    if (template.includes(pattern)) return "fyi"
  }
  return "about_me"
}

/**
 * Count notifications by bucket. Input is an array of objects with a
 * `template` field; everything else is ignored.
 */
export function countByBucket(
  notifications: ReadonlyArray<{ template?: string | null }>
): Record<NotificationBucket, number> {
  const counts: Record<NotificationBucket, number> = {
    awaits_me: 0,
    about_me: 0,
    fyi: 0,
  }
  for (const n of notifications) {
    counts[classifyNotification(n?.template)] += 1
  }
  return counts
}
