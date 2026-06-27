import type { MedusaContainer } from "@medusajs/framework/types"
import { emitBlackoutEvent } from "./blackout-emit"
import { resolveBlackoutUserId } from "./blackout-identity"
import { mapSubscriptionTier } from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Shared §3 membership-sync emitter for the Blackout Creator Hub bridge.
 *
 * A membership subscription is the FBM side of a Blackout Space ACL: when it
 * activates the member should gain their tier rooms, when it lapses they should
 * lose them. We translate every FBM subscription lifecycle transition into one
 * of the two bridge events Blackout already understands —
 * `subscription.activated` / `subscription.lapsed` (see
 * `marketplace-webhooks/models/blackout-events.ts`) — and hand it to the
 * existing fire-and-forget outbound channel (`emitBlackoutEvent`), which signs,
 * dedupes and retries it via the webhook drain job.
 *
 * This was previously inlined in `jobs/process-subscription-renewals.ts`, where
 * only the renewal cron fired it. Lifting it here lets the create/manage
 * workflows reach the same path so a brand-new subscribe (or an immediate
 * cancel) propagates to Blackout in real time instead of waiting up to an hour
 * for the next renewal sweep.
 */

/** Every FBM subscription lifecycle transition that affects room access. */
export type SubscriptionTransition =
  | "subscribe"
  | "renew"
  | "resume"
  | "cancel"
  | "pause"
  | "expire"

/** Which Blackout state each transition resolves to. */
const TRANSITION_STATE: Record<SubscriptionTransition, "activated" | "lapsed"> = {
  subscribe: "activated",
  renew: "activated",
  resume: "activated",
  cancel: "lapsed",
  pause: "lapsed",
  expire: "lapsed",
}

/** Minimal shape the emitter needs off a subscription record. */
export interface EmittableSubscription {
  id: string
  customer_id?: string | null
  metadata?: unknown
  expiration_date?: unknown
}

/**
 * Emit the Blackout bridge event for a subscription transition.
 *
 * Identity: resolves the member's Blackout user id from their FBM customer
 * (the same `blackout_user_id` captured at account-link time). When the member
 * has not linked a Blackout account we SKIP rather than leak a non-Blackout
 * identifier — exactly as the order emitters do.
 *
 * Idempotency: the eventId is stable per (subscription, transition) so the
 * renewal cron re-running, or a workflow retry, never double-delivers the same
 * logical change. Distinct transitions keep distinct ids so a resubscribe after
 * a cancel still lands.
 *
 * Fire-and-forget: never throws — `emitBlackoutEvent` swallows + logs — so a
 * webhook hiccup can never break subscription creation or cancellation.
 *
 * Returns the enqueued eventId, or null when skipped / unconfigured.
 */
export async function emitSubscriptionState(
  container: MedusaContainer,
  subscription: EmittableSubscription,
  transition: SubscriptionTransition
): Promise<string | null> {
  const state = TRANSITION_STATE[transition]

  const userId = await resolveBlackoutUserId(container, {
    customerId: subscription.customer_id ?? null,
  })
  if (!userId) return null

  const tier = mapSubscriptionTier(subscription.metadata)

  return emitBlackoutEvent(
    container,
    state === "activated" ? "subscription.activated" : "subscription.lapsed",
    {
      userId,
      tier,
      subscriptionId: subscription.id,
      ...(state === "activated" && subscription.expiration_date
        ? { expiresAt: new Date(subscription.expiration_date as string).toISOString() }
        : {}),
    },
    { eventId: `subscription.${state}:${subscription.id}:${transition}` }
  )
}
