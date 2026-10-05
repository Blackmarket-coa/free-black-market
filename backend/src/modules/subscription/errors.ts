import { SubscriptionStatus } from "./types"

/**
 * A lifecycle transition the subscription's current status does not allow.
 *
 * Thrown by the service layer — the only place that can reliably refuse to
 * write, whatever route or workflow called it. Store routes map it to 409.
 *
 * Detected by `name`/`code`, never by `instanceof`: an error thrown inside a
 * workflow step can reach the route after the orchestrator has serialised it,
 * and a serialised error keeps its enumerable fields but loses its prototype.
 */
export class SubscriptionTransitionError extends Error {
  readonly code = "subscription_transition_not_allowed" as const
  readonly subscription_id: string
  readonly from_status: string
  readonly action: string

  constructor(args: {
    subscription_id: string
    from_status: SubscriptionStatus | string
    action: string
    allowed_from: ReadonlyArray<SubscriptionStatus | string>
  }) {
    super(
      `Cannot ${args.action} subscription ${args.subscription_id}: status is ` +
        `"${args.from_status}", allowed only from ${args.allowed_from
          .map((s) => `"${s}"`)
          .join(", ")}.`
    )
    this.name = "SubscriptionTransitionError"
    this.subscription_id = args.subscription_id
    this.from_status = String(args.from_status)
    this.action = args.action
  }
}

export function isSubscriptionTransitionError(
  error: unknown
): error is { name: string; code: string; message: string } {
  if (!error || typeof error !== "object") return false
  const e = error as { name?: unknown; code?: unknown }
  return (
    e.name === "SubscriptionTransitionError" ||
    e.code === "subscription_transition_not_allowed"
  )
}

/**
 * Why an auto-renew approval or withdrawal was refused. Store routes map every
 * code to 409 with `type` = the code. Detected by `name`/`code` for the same
 * serialisation reason as SubscriptionTransitionError.
 *
 *   - `auto_renew_disclosure_outdated`: the approval names a disclosure
 *     version other than the current one — the customer must see the current
 *     text and approve again.
 *   - `auto_renew_not_offered`: the product is not marked as one that may be
 *     sold until cancelled.
 *   - `auto_renew_payment_method_required`: no card saved for off-session
 *     renewals (the customer did not approve at purchase, so none was saved).
 *   - `auto_renew_not_available`: the subscription is not in a shape that can
 *     switch auto-renew on (already renewing, or its paid period has ended).
 *   - `auto_renew_not_on`: there is no automatic renewal to withdraw.
 */
export type AutoRenewErrorCode =
  | "auto_renew_disclosure_outdated"
  | "auto_renew_not_offered"
  | "auto_renew_payment_method_required"
  | "auto_renew_not_available"
  | "auto_renew_not_on"

export class AutoRenewError extends Error {
  readonly code: AutoRenewErrorCode
  readonly subscription_id: string

  constructor(code: AutoRenewErrorCode, subscriptionId: string, message: string) {
    super(message)
    this.name = "AutoRenewError"
    this.code = code
    this.subscription_id = subscriptionId
  }
}

const AUTO_RENEW_CODES: ReadonlySet<string> = new Set<AutoRenewErrorCode>([
  "auto_renew_disclosure_outdated",
  "auto_renew_not_offered",
  "auto_renew_payment_method_required",
  "auto_renew_not_available",
  "auto_renew_not_on",
])

export function isAutoRenewError(
  error: unknown
): error is { name: string; code: AutoRenewErrorCode; message: string } {
  if (!error || typeof error !== "object") return false
  const e = error as { name?: unknown; code?: unknown }
  return (
    e.name === "AutoRenewError" ||
    (typeof e.code === "string" && AUTO_RENEW_CODES.has(e.code))
  )
}
