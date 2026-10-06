import { z } from "zod"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import type SubscriptionModuleService from "../modules/subscription/service"
import { manageSubscriptionWorkflow } from "../workflows/subscription"
import {
  isAutoRenewError,
  isSubscriptionTransitionError,
} from "../modules/subscription/errors"
import { isUntilCanceledForProduct } from "../workflows/subscription/grace-lifecycle"

/**
 * The one place a customer's subscription action is carried out.
 *
 * Two routes act on a subscription for the person who owns it:
 *   - `POST /store/subscriptions/:id` (storefront customer bearer), and
 *   - `POST /v1/integrations/blackout/commerce/subscriptions/manage-sessions/{token}/page`
 *     (a Blackout member, through a manage session).
 *
 * Both check ownership their own way, then hand the action here, so they run
 * the same service guards (withdrawAutoRenew / approveAutoRenew), the same
 * cancel workflow (grace, entitlement revocation, the Blackout lapsed event)
 * and map refusals to the same status codes. A second copy of this dispatch
 * would drift — the store route's refusal codes are what the contract promises
 * the manage page answers with.
 */

/** Flag-off actions (FF_CONSUMER_SUBSCRIPTIONS_V1 off): unchanged. */
export const updateSubscriptionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
  reason: z.string().max(500).optional(),
})

/**
 * `approve_auto_renew` needs an explicit `auto_renew_approved: true` plus a
 * disclosure version (which the service then checks is the current one).
 */
export function approvalAnswered(d: {
  action: string
  auto_renew_approved?: true
  auto_renew_disclosure_version?: string
}): boolean {
  return (
    d.action !== "approve_auto_renew" ||
    (d.auto_renew_approved === true && !!d.auto_renew_disclosure_version)
  )
}

export const APPROVAL_ANSWER_MESSAGE =
  "approve_auto_renew requires auto_renew_approved: true and auto_renew_disclosure_version"

/**
 * FF_CONSUMER_SUBSCRIPTIONS_V1 adds two actions:
 *   - `disable_auto_renew`: withdraw the approval; access continues to the end
 *     of the paid period, then the subscription ends;
 *   - `approve_auto_renew`: approve again — an explicit
 *     `auto_renew_approved: true` plus the CURRENT disclosure version.
 * Flag off, the schema above is used unchanged, so these are a 400 as before.
 */
export const manageWithAutoRenewSchema = z
  .object({
    action: z.enum(["pause", "resume", "cancel", "disable_auto_renew", "approve_auto_renew"]),
    reason: z.string().max(500).optional(),
    auto_renew_approved: z.literal(true).optional(),
    auto_renew_disclosure_version: z.string().min(1).max(64).optional(),
  })
  .refine(approvalAnswered, {
    error: APPROVAL_ANSWER_MESSAGE,
    path: ["auto_renew_approved"],
  })

export type SubscriptionAction =
  | "pause"
  | "resume"
  | "cancel"
  | "disable_auto_renew"
  | "approve_auto_renew"

export type SubscriptionActionInput = {
  action: SubscriptionAction
  reason?: string
  auto_renew_disclosure_version?: string
}

type OwnedRow = { id: string; product_id?: string | null }

/**
 * Carry out one action on a subscription the caller has ALREADY checked the
 * requester owns. Throws whatever the service or workflow throws; map it with
 * `subscriptionActionErrorResponse`.
 */
export async function dispatchSubscriptionAction(
  scope: MedusaContainer,
  existing: OwnedRow,
  data: SubscriptionActionInput
): Promise<{ subscription: unknown; action: string; success: boolean }> {
  const id = existing.id
  const subscriptionService = scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)

  // Auto-renew approval actions (FF_CONSUMER_SUBSCRIPTIONS_V1 only — the
  // flag-off schema cannot produce them). The service guards each write.
  if (data.action === "disable_auto_renew") {
    const subscription = await subscriptionService.withdrawAutoRenew(id)
    return { subscription, action: data.action, success: true }
  }
  if (data.action === "approve_auto_renew") {
    const subscription = await subscriptionService.approveAutoRenew(id, {
      disclosure_version: data.auto_renew_disclosure_version ?? "",
      product_allows_until_canceled: await isUntilCanceledForProduct(
        scope,
        existing.product_id ?? null
      ),
    })
    return { subscription, action: data.action, success: true }
  }

  const { result } = await manageSubscriptionWorkflow(scope).run({
    input: {
      subscription_id: id,
      action: data.action,
      reason: data.reason,
    },
  })
  return {
    subscription: result.subscription,
    action: result.action,
    success: result.success,
  }
}

/**
 * The HTTP answer for a refused action, or null when the error is not one of
 * ours (the caller rethrows it):
 *   - validation → 400;
 *   - a lifecycle transition the status does not allow → 409
 *     `subscription_transition_not_allowed`;
 *   - an auto-renew approval/withdrawal refused by the service → 409 with its
 *     code (flag on only).
 */
export function subscriptionActionErrorResponse(
  error: unknown
): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof z.ZodError) {
    return { status: 400, body: { message: "Validation failed", errors: error.issues } }
  }
  // A3: e.g. resume of a subscription that is not paused. The service refuses
  // the write; the caller gets a 409 with the reason.
  if (isSubscriptionTransitionError(error)) {
    return {
      status: 409,
      body: { message: error.message, type: "subscription_transition_not_allowed" },
    }
  }
  if (isAutoRenewError(error)) {
    return { status: 409, body: { message: error.message, type: error.code } }
  }
  return null
}
